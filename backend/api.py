from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import os
from psycopg_pool import AsyncConnectionPool
from contextlib import asynccontextmanager
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from backend import graph_builder
from langchain_core.messages import HumanMessage, AIMessage, AIMessageChunk
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader
from langchain_community.vectorstores import FAISS
import shutil

chatbot = None
memory = None
pool = None
DB_URI = os.getenv("DATABASE_URL")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global chatbot, memory, pool
    
    pool = AsyncConnectionPool(
        conninfo=DB_URI,
        kwargs={"autocommit": True},
        open=False,
    )
    await pool.open()
    
    checkpointer = AsyncPostgresSaver(pool)
    await checkpointer.setup()
    
    memory = checkpointer
    chatbot = graph_builder.compile(checkpointer=memory)
    
    yield
    
    await pool.close()

app = FastAPI(lifespan=lifespan)

# Allow CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from langgraph.types import Command

class ChatRequest(BaseModel):
    message: str | None = None
    thread_id: str = "demo-thread"
    resume: str | bool | None = None

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Standard JSON endpoint for non-streaming (fallback)
    """
    state = Command(resume=request.resume) if request.resume else {"messages": [HumanMessage(content=request.message)]}
    config = {"configurable": {"thread_id": request.thread_id}}
    
    final_response = ""
    async for message_chunk, meta_data in chatbot.astream(state, config=config, stream_mode='messages'):
        if meta_data.get("langgraph_node") == "chat_node":
            if isinstance(message_chunk, (AIMessage, AIMessageChunk)) and message_chunk.content:
                final_response += message_chunk.content
            
    return {"response": final_response}

@app.post("/chat/stream")
async def chat_stream_endpoint(request: ChatRequest):
    """
    Server-Sent Events endpoint for streaming with HITL support
    """
    async def event_generator():
        state = Command(resume=request.resume) if request.resume else {"messages": [HumanMessage(content=request.message)]}
        config = {"configurable": {"thread_id": request.thread_id}}
        
        try:
            while True:
                async for message_chunk, meta_data in chatbot.astream(state, config=config, stream_mode='messages'):
                    if meta_data.get("langgraph_node") == "chat_node":
                        if isinstance(message_chunk, (AIMessage, AIMessageChunk)) and message_chunk.content:
                            content = message_chunk.content
                            content_str = ""
                            if isinstance(content, str):
                                content_str = content
                            elif isinstance(content, list):
                                content_str = "".join([item.get("text", "") for item in content if isinstance(item, dict) and item.get("type") == "text"])
                            
                            if content_str:
                                data = json.dumps({"chunk": content_str})
                                yield f"data: {data}\n\n"
                
                # Check graph state for interrupts
                current_state = await chatbot.aget_state(config)
                if current_state.tasks and current_state.tasks[0].interrupts:
                    interrupt_val = current_state.tasks[0].interrupts[0].value
                    if isinstance(interrupt_val, dict) and interrupt_val.get("action") == "purchase_stock":
                        # Yield HITL event and pause execution
                        hitl_data = json.dumps({
                            "type": "hitl_required", 
                            "tool_calls": [{"args": {"symbol": interrupt_val["symbol"], "quantity": interrupt_val["quantity"]}}]
                        })
                        yield f"data: {hitl_data}\n\n"
                        break
                    else:
                        state = None
                else:
                    break
        except Exception as e:
            error_data = json.dumps({"error": str(e)})
            yield f"data: {error_data}\n\n"
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/chat/history/{thread_id}")
async def get_chat_history(thread_id: str):
    """
    Retrieve message history for a specific thread_id from the LangGraph checkpointer.
    """
    config = {"configurable": {"thread_id": thread_id}}
    try:
        # Get the compiled graph state
        state = await chatbot.aget_state(config)
        
        # Extract messages list from state values
        messages = state.values.get("messages", []) if state.values else []
        
        # Format messages for the frontend
        formatted_messages = []
        for msg in messages:
            if isinstance(msg, HumanMessage):
                formatted_messages.append({
                    "text": msg.content,
                    "sender": "user"
                })
            elif isinstance(msg, AIMessage):
                # Ensure we only include messages with content (skip empty tool calls/responses)
                if msg.content:
                    formatted_messages.append({
                        "text": msg.content,
                        "sender": "bot"
                    })
                    
        return {"messages": formatted_messages}
    except Exception as e:
        return {"messages": [], "error": str(e)}

@app.get("/chat/threads")
async def get_threads():
    """
    Retrieve all unique thread_ids from Postgres checkpoints table and generate titles.
    """
    try:
        # Connect and query unique thread IDs
        async with pool.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT DISTINCT thread_id FROM checkpoints")
                rows = await cursor.fetchall()
                thread_ids = [row[0] for row in rows]
        
        # Build threads with titles from the first HumanMessage
        threads_list = []
        for t_id in thread_ids:
            config = {"configurable": {"thread_id": t_id}}
            state = await chatbot.aget_state(config)
            messages = state.values.get("messages", []) if state.values else []
            
            # Find the first user message to use as title
            title = "New Chat"
            for msg in messages:
                if isinstance(msg, HumanMessage) and msg.content:
                    title = msg.content[:30] + ("..." if len(msg.content) > 30 else "")
                    break
                    
            threads_list.append({
                "id": t_id,
                "title": title
            })
            
        return {"threads": threads_list}
    except Exception as e:
        return {"threads": [], "error": str(e)}

@app.delete("/chat/threads/{thread_id}")
async def delete_thread(thread_id: str):
    """
    Delete a specific thread from the database.
    """
    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("DELETE FROM checkpoints WHERE thread_id = %s", (thread_id,))
                await cursor.execute("DELETE FROM writes WHERE thread_id = %s", (thread_id,))
            await conn.commit()
            
        # Delete corresponding vector store if it exists
        vectorstore_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectorstores", thread_id)
        if os.path.exists(vectorstore_path):
            shutil.rmtree(vectorstore_path)
            
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.delete("/chat/threads")
async def clear_all_threads():
    """
    Delete all threads from the database.
    """
    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("DELETE FROM checkpoints")
                await cursor.execute("DELETE FROM writes")
            await conn.commit()
            
        # Delete all vector stores
        vectorstores_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectorstores")
        if os.path.exists(vectorstores_dir):
            for item in os.listdir(vectorstores_dir):
                item_path = os.path.join(vectorstores_dir, item)
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                    
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/upload-pdf")
async def upload_pdf(thread_id: str = Form(...), file: UploadFile = File(...)):
    """
    Endpoint to upload a PDF file and vectorise it for a specific chat thread.
    """
    if not file.filename.endswith('.pdf'):
        return {"status": "error", "message": "Only PDF files are allowed"}
        
    try:
        # Save uploaded file temporarily
        temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp")
        os.makedirs(temp_dir, exist_ok=True)
        temp_file_path = os.path.join(temp_dir, file.filename)
        
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Load and split PDF
        loader = PyPDFLoader(temp_file_path)
        documents = loader.load()
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=4000, chunk_overlap=400)
        splits = text_splitter.split_documents(documents)
        
        # Create or update FAISS index
        vectorstore_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectorstores", thread_id)
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-2")
        
        if os.path.exists(vectorstore_path):
            vectorstore = FAISS.load_local(vectorstore_path, embeddings, allow_dangerous_deserialization=True)
            vectorstore.add_documents(splits)
            vectorstore.save_local(vectorstore_path)
        else:
            os.makedirs(vectorstore_path, exist_ok=True)
            vectorstore = FAISS.from_documents(splits, embeddings)
            vectorstore.save_local(vectorstore_path)
            
        # Clean up temp file
        os.remove(temp_file_path)
        
        return {"status": "success", "message": f"Successfully processed {len(splits)} chunks from {file.filename}."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=os.getenv("PORT", 8000))
