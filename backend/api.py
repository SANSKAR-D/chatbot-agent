from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import os
import aiosqlite
from contextlib import asynccontextmanager
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend import graph_builder
from langchain_core.messages import HumanMessage, AIMessage, AIMessageChunk
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader
from langchain_community.vectorstores import FAISS
from langchain_ollama import OllamaEmbeddings
import shutil

chatbot = None
memory = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global chatbot, memory
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chatbot.db")
    async with AsyncSqliteSaver.from_conn_string(db_path) as saver:
        memory = saver
        chatbot = graph_builder.compile(checkpointer=memory)
        yield

app = FastAPI(lifespan=lifespan)

# Allow CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    thread_id: str = "demo-thread"

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Standard JSON endpoint for non-streaming (fallback)
    """
    state = {"messages": [HumanMessage(content=request.message)]}
    config = {"configurable": {"thread_id": request.thread_id}}
    
    final_response = ""
    async for message_chunk, meta_data in chatbot.astream(state, config=config, stream_mode='messages'):
        if isinstance(message_chunk, (AIMessage, AIMessageChunk)) and message_chunk.content:
            final_response += message_chunk.content
            
    return {"response": final_response}

@app.post("/chat/stream")
async def chat_stream_endpoint(request: ChatRequest):
    """
    Server-Sent Events endpoint for streaming
    """
    async def event_generator():
        state = {"messages": [HumanMessage(content=request.message)]}
        config = {"configurable": {"thread_id": request.thread_id}}
        
        try:
            async for message_chunk, meta_data in chatbot.astream(state, config=config, stream_mode='messages'):
                if isinstance(message_chunk, (AIMessage, AIMessageChunk)) and message_chunk.content:
                    data = json.dumps({"chunk": message_chunk.content})
                    yield f"data: {data}\n\n"
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
    Retrieve all unique thread_ids from SQLite checkpoints table and generate titles.
    """
    try:
        # Resolve the database path
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chatbot.db")
        
        # Connect and query unique thread IDs
        async with aiosqlite.connect(db_path) as conn:
            async with conn.execute("SELECT DISTINCT thread_id FROM checkpoints") as cursor:
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
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chatbot.db")
        async with aiosqlite.connect(db_path) as conn:
            await conn.execute("DELETE FROM checkpoints WHERE thread_id = ?", (thread_id,))
            await conn.execute("DELETE FROM writes WHERE thread_id = ?", (thread_id,))
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
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chatbot.db")
        async with aiosqlite.connect(db_path) as conn:
            await conn.execute("DELETE FROM checkpoints")
            await conn.execute("DELETE FROM writes")
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
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        splits = text_splitter.split_documents(documents)
        
        # Create or update FAISS index
        vectorstore_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectorstores", thread_id)
        embeddings = OllamaEmbeddings(model="nomic-embed-text")
        
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
