from asyncio import coroutines
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import os
import sqlite3

from backend import chatbot
from langchain_core.messages import HumanMessage, AIMessage, AIMessageChunk

app = FastAPI()

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
    for message_chunk, meta_data in chatbot.stream(state, config=config, stream_mode='messages'):
        if isinstance(message_chunk, (AIMessage, AIMessageChunk)) and message_chunk.content:
            final_response += message_chunk.content
            
    return {"response": final_response}

@app.post("/chat/stream")
async def chat_stream_endpoint(request: ChatRequest):
    """
    Server-Sent Events endpoint for streaming
    """
    def event_generator():
        state = {"messages": [HumanMessage(content=request.message)]}
        config = {"configurable": {"thread_id": request.thread_id}}
        
        try:
            for message_chunk, meta_data in chatbot.stream(state, config=config, stream_mode='messages'):
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
        state = chatbot.get_state(config)
        
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
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT thread_id FROM checkpoints")
        thread_ids = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        # Build threads with titles from the first HumanMessage
        threads_list = []
        for t_id in thread_ids:
            config = {"configurable": {"thread_id": t_id}}
            state = chatbot.get_state(config)
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=os.getenv("PORT", 8000))
