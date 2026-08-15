import os
from typing import TypedDict, List
from langgraph.graph import StateGraph, START, END
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.runnables import RunnableConfig
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

# -------------------
# 1. State
# -------------------
class RagState(TypedDict):
    question: str
    documents: List[str]
    generation: str
    retries: int

# -------------------
# 2. Models
# -------------------
llm_gen = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", temperature=0)
llm_eval = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite", temperature=0)

class GradeDocuments(BaseModel):
    """Boolean score for relevance check on retrieved documents."""
    binary_score: str = Field(description="Documents are relevant to the question, 'yes' or 'no'")

class GradeHallucinations(BaseModel):
    """Boolean score for hallucination present in generation answer."""
    binary_score: str = Field(description="Answer is supported by the facts, 'yes' or 'no'")

class GradeAnswer(BaseModel):
    """Boolean score to assess answer addresses question."""
    binary_score: str = Field(description="Answer addresses the question, 'yes' or 'no'")

structured_llm_grader = llm_eval.with_structured_output(GradeDocuments)
hallucination_grader = llm_eval.with_structured_output(GradeHallucinations)
answer_grader = llm_eval.with_structured_output(GradeAnswer)

# -------------------
# 3. Nodes
# -------------------


async def retrieve(state: RagState, config: RunnableConfig):
    """Retrieve documents from FAISS."""
    print("---RETRIEVE---")
    question = state["question"]
    thread_id = config.get("configurable", {}).get("thread_id")
    
    if not thread_id:
        return {"documents": []}
        
    vectorstore_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectorstores", thread_id)
    if not os.path.exists(vectorstore_path):
        return {"documents": []}
        
    embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-2")
    vectorstore = FAISS.load_local(vectorstore_path, embeddings, allow_dangerous_deserialization=True)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
    docs = await retriever.ainvoke(question)
    
    return {"documents": [d.page_content for d in docs]}

async def generate_from_context(state: RagState):
    """Generate answer using context."""
    print("---GENERATE FROM CONTEXT---")
    question = state["question"]
    documents = state["documents"]
    
    context = "\n\n".join(documents) if documents else "No relevant documents found."
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question. If you don't know the answer, just say that you don't know. Use three sentences maximum and keep the answer concise.\n\nContext:\n{context}"),
        ("human", "{question}")
    ])
    
    chain = prompt | llm_gen
    response = await chain.ainvoke({"context": context, "question": question})
    
    return {"generation": response.content}

async def revise_answer(state: RagState):
    """Revise the generated answer to fix hallucinations."""
    print("---REVISE ANSWER---")
    question = state["question"]
    documents = state["documents"]
    generation = state.get("generation", "")
    
    context = "\n\n".join(documents)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an assistant for question-answering tasks. Your previous answer to the question was found to contain hallucinations (information not supported by the context). Please rewrite the answer using ONLY the provided context.\n\nContext:\n{context}\n\nPrevious Answer:\n{generation}"),
        ("human", "{question}")
    ])
    
    chain = prompt | llm_gen
    response = await chain.ainvoke({"context": context, "generation": generation, "question": question})
    
    retries = state.get("retries", 0)
    return {"generation": response.content, "retries": retries + 1}

async def rewrite_question(state: RagState):
    """Rewrite the question to get better results."""
    print("---REWRITE QUESTION---")
    question = state["question"]
    retries = state.get("retries", 0)
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a question re-writer that converts an input question to a better version that is optimized for vectorstore retrieval. Look at the input and try to reason about the underlying semantic intent / meaning."),
        ("human", "Here is the initial question: \n\n {question} \n Formulate an improved question.")
    ])
    
    chain = prompt | llm_eval
    response = await chain.ainvoke({"question": question})
    
    return {"question": response.content, "retries": retries + 1}

async def generate_direct(state: RagState):
    """Directly generate answer without context."""
    print("---GENERATE DIRECT---")
    question = state["question"]
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an assistant for question-answering tasks. Answer the following question based on your general knowledge."),
        ("human", "{question}")
    ])
    
    chain = prompt | llm_gen
    response = await chain.ainvoke({"question": question})
    
    return {"generation": response.content}

async def no_answer_found(state: RagState):
    """Fallback when no answer can be found."""
    print("---NO ANSWER FOUND---")
    return {"generation": "I'm sorry, but I couldn't find a relevant answer in the uploaded documents."}

async def evaluate_usefulness(state: RagState):
    """Dummy node to hang the is_use edge on."""
    return {}

# -------------------
# 4. Conditional Edges
# -------------------


async def is_relevant(state: RagState):
    """Check if retrieved documents are relevant to the question."""
    print("---CHECK RELEVANCE---")
    question = state["question"]
    documents = state["documents"]
    
    if not documents:
        return "no_answer_found"
        
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a grader assessing relevance of a retrieved document to a user question. If the document contains keyword(s) or semantic meaning related to the user question, grade it as relevant. Give a binary score 'yes' or 'no' score to indicate whether the document is relevant to the question."),
        ("human", "Retrieved document: \n\n {document} \n\n User question: {question}")
    ])
    
    chain = prompt | structured_llm_grader
    
    for doc in documents:
        try:
            score = await chain.ainvoke({"document": doc, "question": question})
            if score.binary_score.lower() == "yes":
                return "generate_from_context"
        except Exception:
            pass # Ignore parsing errors
            
    return "no_answer_found"

async def is_sup(state: RagState):
    """Check if generation is supported by the documents (no hallucinations)."""
    print("---CHECK HALLUCINATIONS---")
    documents = state["documents"]
    generation = state.get("generation", "")
    
    context = "\n\n".join(documents)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a grader assessing whether an LLM generation is supported by a set of retrieved facts. \nGive a binary score 'yes' or 'no'. 'Yes' means that the answer is supported by the facts (contains no hallucinations)."),
        ("human", "Set of facts: \n\n {documents} \n\n LLM generation: {generation}")
    ])
    
    chain = prompt | hallucination_grader
    try:
        score = await chain.ainvoke({"documents": context, "generation": generation})
        if score.binary_score.lower() == "yes":
            return "evaluate_usefulness"
    except Exception:
        pass
        
    if state.get("retries", 0) >= 1:
        return "no_answer_found"
    return "revise_answer"

async def is_use(state: RagState):
    """Check if the generation is useful (answers the question)."""
    print("---CHECK USEFULNESS---")
    question = state["question"]
    generation = state.get("generation", "")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a grader assessing whether an answer addresses / resolves a question. \nGive a binary score 'yes' or 'no'. 'Yes' means that the answer resolves the question."),
        ("human", "User question: \n\n {question} \n\n LLM generation: {generation}")
    ])
    
    chain = prompt | answer_grader
    try:
        score = await chain.ainvoke({"question": question, "generation": generation})
        if score.binary_score.lower() == "yes":
            return END
    except Exception:
        pass
        
    if state.get("retries", 0) >= 1:
        return "no_answer_found"
    return "rewrite_question"

# -------------------
# 5. Graph Compilation
# -------------------
workflow = StateGraph(RagState)

workflow.add_node("retrieve", retrieve)
workflow.add_node("generate_direct", generate_direct)
workflow.add_node("generate_from_context", generate_from_context)
workflow.add_node("revise_answer", revise_answer)
workflow.add_node("evaluate_usefulness", evaluate_usefulness)
workflow.add_node("rewrite_question", rewrite_question)
workflow.add_node("no_answer_found", no_answer_found)

workflow.add_edge(START, "retrieve")

workflow.add_edge("generate_direct", END)
workflow.add_edge("no_answer_found", END)

workflow.add_conditional_edges("retrieve", is_relevant, {
    "generate_from_context": "generate_from_context",
    "no_answer_found": "no_answer_found"
})

workflow.add_conditional_edges("generate_from_context", is_sup, {
    "evaluate_usefulness": "evaluate_usefulness",
    "revise_answer": "revise_answer",
    "no_answer_found": "no_answer_found"
})

workflow.add_conditional_edges("revise_answer", is_sup, {
    "evaluate_usefulness": "evaluate_usefulness",
    "revise_answer": "revise_answer",
    "no_answer_found": "no_answer_found"
})

workflow.add_conditional_edges("evaluate_usefulness", is_use, {
    END: END,
    "rewrite_question": "rewrite_question",
    "no_answer_found": "no_answer_found"
})

workflow.add_edge("rewrite_question", "retrieve")

rag_graph = workflow.compile()
