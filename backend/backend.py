from langchain_ollama import OllamaEmbeddings
from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Annotated
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, AIMessageChunk, SystemMessage

from psycopg_pool import AsyncConnectionPool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_core.tools import tool
from dotenv import load_dotenv
from langgraph.types import interrupt, Command
from langgraph.store.base import BaseStore
from langgraph.prebuilt import InjectedStore
from langchain_core.messages import ToolMessage
from tavily import AsyncTavilyClient
import httpx
import asyncio
import os
import uuid
from langchain_core.runnables import RunnableConfig
from langchain_community.vectorstores import FAISS
import pyfiglet
load_dotenv()

# -------------------
# 1. LLM
# -------------------
from langchain_google_genai import ChatGoogleGenerativeAI
llm = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", temperature=0)

# -------------------
# 2. Tools
# -------------------
@tool
async def get_stock_price(symbol: str) -> dict:
    """
    Get the latest stock price for a given stock with symbol (e.g. 'AAPL', 'TSLA') .
    """
    url = (
        f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={os.getenv('STOCK_API')}"
    )
    async with httpx.AsyncClient() as client:
        r = await client.get(url)
        return r.json()

@tool
async def get_weather(city:str) -> dict:
    """
    Get the current weather for a specific city.
    """
    url = (
        f"http://api.weatherapi.com/v1/current.json?key={os.getenv('WEATHER_API_KEY')}&q={city}"
    )
    async with httpx.AsyncClient() as client:
        r = await client.get(url)
        return r.json()

@tool
async def purchase_stock(symbol: str, quantity: int) -> dict:
    """
    Purchasing a given quantity of a stock symbol.

    NOTE: This is a mock implementation:
    - No real brokerage API is called.
    - It simply returns a confirmation payload.
    """
    response = interrupt({"action": "purchase_stock", "symbol": symbol, "quantity": quantity})
    if response == "reject":
        return {"status": "error", "message": "User rejected the purchase."}
        
    await asyncio.sleep(0.1)
    return {
        "status": "success",
        "message": f"Purchase order placed for {quantity} shares of {symbol}.",
        "symbol": symbol,
        "quantity": quantity,
    }

@tool
async def search(query: str) -> dict:
    """
    Search the web for real-time information, news, current events, dates, historical facts, places, or any question you do not have the answer to.
    Use this tool whenever the user asks about something that requires searching the internet or fetching current details.
    """
    tavily = AsyncTavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

    response = await tavily.search(query=query, max_results=5, search_depth="advanced")
    return response

@tool
async def search_pdf(query: str, config: RunnableConfig) -> str:
    """
    Search the uploaded PDF documents for the current chat for relevant information.
    Use this tool whenever the user asks questions about their uploaded PDF files, documents, or requests a summary or content extraction.
    Input a descriptive search query based on what the user is asking. If they ask for a summary, query for 'summary or main topics'.
    """
    # This tool is intercepted by route_after_chat and processed by rag_node subgraph.
    # It will never actually be executed here.
    return "Processed by RAG subgraph"

@tool
async def generate_ascii_art(text: str, font: str = "standard") -> str:
    """
    Generate ASCII art from a text string.
    Input the text to convert, and optionally a font style (e.g. 'standard', 'slant', 'shadow', 'block', 'isometric1').
    """
    try:
        # Fallback to standard font if requested font doesn't exist
        if font not in pyfiglet.FigletFont.getFonts():
            font = "standard"
        ascii_art = pyfiglet.figlet_format(text, font=font)
        return ascii_art
    except Exception as e:
        return f"Error generating ASCII art: {str(e)}"

@tool
async def save_user_memory(
    fact: str,
    config: RunnableConfig,
    store: Annotated[BaseStore, InjectedStore()]
) -> str:
    """
    Save a user preference, name, location, or any personal fact to long-term memory.
    You MUST call this tool proactively whenever the user shares information about themselves, 
    their interests, their life, or how they like to be addressed. 
    This allows you to build a personalized profile over time.
    """
    user_id = config.get("configurable", {}).get("user_id", "default_user")
    namespace = ("user_profile", user_id)
    
    # Check for duplicates using semantic search
    existing = await store.asearch(namespace, query=fact, limit=3)
    for mem in existing:
        existing_fact = mem.value.get("fact", "")
        # Exact string match check
        if existing_fact.lower() == fact.lower():
            return "Fact already known (exact duplicate)."
        
        # Semantic similarity check (distance near 0 or similarity near 1)
        if hasattr(mem, 'score') and mem.score is not None:
            if mem.score < 0.15 or mem.score > 0.85:
                return f"Fact already known (semantically similar to: {existing_fact})."
    
    # Save the new fact as a distinct item for vectorization
    fact_id = str(uuid.uuid4())
    await store.aput(namespace, fact_id, {"fact": fact})
    return f"Successfully saved fact: {fact}"

tools = [get_stock_price, purchase_stock, get_weather, search, search_pdf, generate_ascii_art, save_user_memory]
llm_with_tools = llm.bind_tools(tools)

# -------------------
# 3. State
# -------------------
class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    summary: str
    summarized_count: int

# -------------------
# 4. Nodes
# -------------------
async def summarize_node(state: ChatState):
    """Summarize older messages to prevent context overflow."""
    messages = state["messages"]
    summary = state.get("summary", "")
    summarized_count = state.get("summarized_count", 0)
    
    keep_count = 6
    if len(messages) - summarized_count > keep_count:
        split_idx = len(messages) - keep_count
        
        # Scan backwards to find the nearest HumanMessage.
        # This ensures the active_messages list always begins with a User turn,
        # which satisfies Gemini's strict turn alternation rules.
        while split_idx > summarized_count and not isinstance(messages[split_idx], HumanMessage):
            split_idx -= 1
            
        if split_idx == summarized_count:
            # Cannot safely split without breaking a turn
            return {}
            
        to_summarize = messages[summarized_count : split_idx]
        
        if summary:
            prompt = (
                f"Here is the current summary of the conversation:\n{summary}\n\n"
                "Please extend this summary by incorporating the new messages above. "
                "Keep it concise and focus on the main points."
            )
        else:
            prompt = "Please create a concise summary of the conversation above."
            
        # Place the instructions at the END as a HumanMessage so Gemini accepts it
        summary_sys = SystemMessage(content="You are an AI tasked with summarizing conversations.")
        summary_req = HumanMessage(content=prompt)
        
        response = await llm.ainvoke([summary_sys] + to_summarize + [summary_req])
        
        return {
            "summary": response.content,
            "summarized_count": split_idx
        }
    return {}

async def chat_node(state: ChatState, config: RunnableConfig, store: BaseStore):
    """LLM node that may answer or request a tool call."""
    messages = state["messages"]
    summary = state.get("summary", "")
    summarized_count = state.get("summarized_count", 0)
    
    active_messages = messages[summarized_count:]
    
    sys_content = (
        "You are an advanced, highly personalized AI assistant. Your primary goal is to be exceptionally helpful while building a warm, ongoing relationship with the user.\n\n"
        "--- CAPABILITIES & TOOLS ---\n"
        "- You have real-time access to the internet, weather, stocks, and the user's uploaded PDFs. NEVER say you lack access to real-time data or documents.\n"
        "- If a question requires current facts, external knowledge, or real-time data, you MUST use the 'search', 'get_weather', or 'get_stock_price' tools. Do not guess.\n"
        "- For PDF or document-related questions, ALWAYS use 'search_pdf'.\n"
        "- For ASCII art requests, use 'generate_ascii_art'. Do not draw it yourself.\n"
        "- When presenting stock prices or financial data, ensure your markdown formatting is perfectly clean. Do NOT split bold text or italics across newlines, and DO NOT insert errant asterisks.\n\n"
        "--- PERSONALIZATION & BEHAVIOR ---\n"
        "1. PROACTIVE MEMORY: You are equipped with a Long-Term Memory tool ('save_user_memory'). You MUST actively listen for new facts about the user (name, location, hobbies, job, preferences) and call this tool in the background to save them.\n"
        "2. TAILORED RESPONSES: Use the 'USER PROFILE & LONG-TERM MEMORY' facts (provided below) to customize your answers. Greet them by name, tie answers back to their interests natively, and match their preferred tone.\n"
        "3. NATURAL CONVERSATION: Be conversational and friendly. Do not be overly robotic or constantly remind the user you are an AI.\n"
    )
    if summary:
        sys_content += f"\n\nSummary of older conversation:\n{summary}"
        
    user_id = config.get("configurable", {}).get("user_id", "default_user")
    namespace = ("user_profile", user_id)
    
    # Use the latest user message to run a semantic search against the user's memories
    query = active_messages[-1].content if active_messages else ""
    memories = await store.asearch(namespace, query=query, limit=5)
    
    if memories:
        sys_content += "\n\n--- USER PROFILE & LONG-TERM MEMORY ---\n"
        sys_content += "Use these highly relevant facts to craft personalized responses:\n"
        for mem in memories:
            fact = mem.value.get("fact", "")
            if fact:
                sys_content += f"- {fact}\n"
        sys_content += "---------------------------------------\n"
        
    system_message = SystemMessage(content=sys_content)
    
    response = await llm_with_tools.ainvoke([system_message] + active_messages)
    return {"messages": [response]}

tool_node = ToolNode(tools)

# -------------------
# 5. Checkpointer (persistent SQLite)
# -------------------
# Note: Checkpointer is attached at runtime dynamically using async connection.

# -------------------
# 6. Graph
# -------------------
def should_summarize(state: ChatState):
    messages = state["messages"]
    summarized_count = state.get("summarized_count", 0)
    if len(messages) - summarized_count > 6:
        return "summarize_node"
    return "chat_node"

async def rag_node(state: ChatState, config: RunnableConfig):
    """Subgraph wrapper node for RAG processing."""
    from rag import rag_graph
    
    last_message = state["messages"][-1]
    tool_messages = []
    
    for tc in getattr(last_message, "tool_calls", []):
        if tc["name"] == "search_pdf":
            query = tc.get("args", {}).get("query", "")
            
            if not isinstance(query, str):
                texts = []
                if isinstance(query, list):
                    def extract_text(item):
                        if isinstance(item, list):
                            for sub in item: extract_text(sub)
                        elif isinstance(item, dict) and item.get("type") == "text":
                            texts.append(item.get("text", ""))
                        elif isinstance(item, str):
                            texts.append(item)
                    extract_text(query)
                    query = " ".join(texts)
                else:
                    query = str(query)
                query = query[:2000]
                
            result = await rag_graph.ainvoke({"question": query}, config)
            ans = result.get("generation", "No answer found.")
            tool_messages.append(ToolMessage(tool_call_id=tc["id"], name="search_pdf", content=ans))
            
    return {"messages": tool_messages}

def route_after_chat(state: ChatState):
    """Route to tools, rag_node, or END based on tool calls."""
    last_message = state["messages"][-1]
    
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        if any(tc["name"] == "search_pdf" for tc in last_message.tool_calls):
            return "rag_node"
        return "tools"
    return END

graph_builder = StateGraph(ChatState)
graph_builder.add_node("summarize_node", summarize_node)
graph_builder.add_node("chat_node", chat_node)
graph_builder.add_node("tools", tool_node)
graph_builder.add_node("rag_node", rag_node)

graph_builder.add_conditional_edges(START, should_summarize)
graph_builder.add_edge("summarize_node", "chat_node")

graph_builder.add_conditional_edges("chat_node", route_after_chat, {
    "rag_node": "rag_node",
    "tools": "tools",
    END: END
})
graph_builder.add_edge("tools", "chat_node")
graph_builder.add_edge("rag_node", "chat_node")

# We export graph_builder so we can compile it with async memory in api.py
graph = graph_builder.compile()