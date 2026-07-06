from asyncio import coroutines
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import os

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
    async def event_generator():
        state = {"messages": [HumanMessage(content=request.message)]}
        config = {"configurable": {"thread_id": request.thread_id}}
        
        try:
            for message_chunk, meta_data in chatbot.stream(state, config=config, stream_mode='messages'):
                if isinstance(message_chunk, (AIMessage, AIMessageChunk)) and message_chunk.content:
                    data = json.dumps({"chunk": message_chunk.content})
                    yield f"data: {data}\n\n"
                    await asyncio.sleep(0.01)
        except Exception as e:
            error_data = json.dumps({"error": str(e)})
            yield f"data: {error_data}\n\n"
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=os.getenv("PORT", 8000))
