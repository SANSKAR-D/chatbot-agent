from langchain_ollama import OllamaEmbeddings
from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Annotated
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, AIMessageChunk, SystemMessage
from langchain_ollama import ChatOllama
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
import aiosqlite
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_core.tools import tool
from dotenv import load_dotenv
from langgraph.types import interrupt, Command
from tavily import AsyncTavilyClient
import httpx
import asyncio
import os
from langchain_core.runnables import RunnableConfig
from langchain_community.vectorstores import FAISS
import pyfiglet
load_dotenv()

# -------------------
# 1. LLM
# -------------------
llm = ChatOllama(model = "qwen2.5:3b", temperature = 0)

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
    thread_id = config.get("configurable", {}).get("thread_id")
    if not thread_id:
        return "Error: No active chat thread ID found."
    
    vectorstore_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectorstores", thread_id)
    if not os.path.exists(vectorstore_path):
        return "No PDF documents have been uploaded for this chat yet."
    
    try:
        embeddings = OllamaEmbeddings(model="nomic-embed-text")
        vectorstore = FAISS.load_local(vectorstore_path, embeddings, allow_dangerous_deserialization=True)
        retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
        docs = await retriever.ainvoke(query)
        
        if not docs:
            return "No relevant information found in the uploaded documents."
            
        return "\n\n".join([d.page_content for d in docs])
    except Exception as e:
        return f"Error searching PDF documents: {str(e)}"

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

tools = [get_stock_price, purchase_stock, get_weather, search, search_pdf, generate_ascii_art]
llm_with_tools = llm.bind_tools(tools)

# -------------------
# 3. State
# -------------------
class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]

# -------------------
# 4. Nodes
# -------------------
async def chat_node(state: ChatState):
    """LLM node that may answer or request a tool call."""
    messages = state["messages"]
    system_message = SystemMessage(
        content=(
            "You are a helpful AI agent with access to real-time tools and uploaded documents.\n"
            "CRITICAL RULES:\n"
            "1. ALWAYS use the appropriate tool (get_weather, get_stock_price, search) if the user asks about real-time, "
            "current, historical, factual, or search-based topics (e.g. weather, stocks, places, events, facts, queries).\n"
            "2. Do NOT attempt to answer questions about external facts, current events, or real-time data from your own memory. You MUST call a tool.\n"
            "3. If you do not know the answer to a question or are unsure, ALWAYS use the 'search' tool.\n"
            "4. Never say you don't have access to tools or real-time data.\n"
            "5. The user can upload PDF documents to this chat. You HAVE ACCESS to these documents via the 'search_pdf' tool. If the user asks about an uploaded document, PDF, notes, or its contents, you MUST use the 'search_pdf' tool to retrieve the information. NEVER say you cannot access or read documents.\n"
            "6. If the user asks for ASCII art, a text banner, or stylized text, ALWAYS use the 'generate_ascii_art' tool. Do NOT attempt to construct ASCII art yourself.\n"
        )
    )
    response = await llm_with_tools.ainvoke([system_message] + messages)
    return {"messages": [response]}

tool_node = ToolNode(tools)

# -------------------
# 5. Checkpointer (persistent SQLite)
# -------------------
# Note: Checkpointer is attached at runtime dynamically using async connection.

# -------------------
# 6. Graph
# -------------------
graph_builder = StateGraph(ChatState)
graph_builder.add_node("chat_node", chat_node)
graph_builder.add_node("tools", tool_node)

graph_builder.add_edge(START, "chat_node")

graph_builder.add_conditional_edges("chat_node", tools_condition)
graph_builder.add_edge("tools", "chat_node")

# We export graph_builder so we can compile it with async memory in api.py
graph = graph_builder.compile()

# -------------------
# 7. Simple usage example (CLI)
# -------------------
async def main():
    print("Bot with Tools")
    print("Type 'exit' to quit.\n")

    # thread_id still works with MemorySaver (conversation kept in RAM)
    thread_id = "demo-thread"

    async with AsyncSqliteSaver.from_conn_string("chatbot.db") as memory:
        chatbot = graph_builder.compile(checkpointer=memory)
        config = {"configurable": {"thread_id": thread_id}}
        
        while True:
            user_input = input("You: ")
            if user_input.lower().strip() in {"exit", "quit"}:
                print("Goodbye!")
                break

            # Build initial state for this turn
            state = {"messages": [HumanMessage(content=user_input)]}

            while True:
                async for message_chunk, meta_data in chatbot.astream(
                    state,
                    config=config,
                    stream_mode='messages'
                ):
                    if isinstance(message_chunk, (AIMessage, AIMessageChunk)) and message_chunk.content:
                        print(message_chunk.content, end="",flush = True)
                
                # Check for interrupts
                current_state = await chatbot.aget_state(config)
                if current_state.tasks and current_state.tasks[0].interrupts:
                    interrupt_val = current_state.tasks[0].interrupts[0].value
                    if isinstance(interrupt_val, dict) and interrupt_val.get("action") == "purchase_stock":
                        print(f"\n[SYSTEM]: The AI wants to purchase {interrupt_val['quantity']} shares of {interrupt_val['symbol']}. Approve? (yes/no): ", end="")
                        ans = input()
                        if ans.lower().strip() in {"y", "yes"}:
                            state = Command(resume="approve")
                        else:
                            state = Command(resume="reject")
                    else:
                        state = None
                else:
                    print("")
                    break

if __name__ == "__main__":
    asyncio.run(main())