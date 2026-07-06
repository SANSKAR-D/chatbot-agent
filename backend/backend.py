from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Annotated
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, AIMessageChunk, SystemMessage
from langchain_ollama import ChatOllama
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_core.tools import tool
from dotenv import load_dotenv
from tavily import TavilyClient
import requests
import os
load_dotenv()

# -------------------
# 1. LLM
# -------------------
llm = ChatOllama(model = "qwen2.5:3b")

# -------------------
# 2. Tools
# -------------------
@tool
def get_stock_price(symbol: str) -> dict:
    """
    Get the latest stock price for a given stock with symbol (e.g. 'AAPL', 'TSLA') .
    """
    url = (
        f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={os.getenv("STOCK_API")}"
    )
    r = requests.get(url)
    return r.json()

@tool
def get_weather(city:str) -> dict:
    """
    Get the current weather for a specific city.
    """
    url = (
        f"http://api.weatherapi.com/v1/current.json?key={os.getenv("WEATHER_API_KEY")}&q={city}"
    )
    r = requests.get(url)
    return r.json()

@tool
def purchase_stock(symbol: str, quantity: int) -> dict:
    """
    Simulate purchasing a given quantity of a stock symbol.

    NOTE: This is a mock implementation:
    - No real brokerage API is called.
    - It simply returns a confirmation payload.
    """
    return {
        "status": "success",
        "message": f"Purchase order placed for {quantity} shares of {symbol}.",
        "symbol": symbol,
        "quantity": quantity,
    }

@tool
def search(search : str) -> dict:
    """
    Search the web for anything you don't know real time,data,shops,places,etc.
    Search the web for a given query if you don't know the answer of it.
    """
    tavily = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

    response = tavily.search(query=search, max_results=5)

    return response

tools = [get_stock_price, purchase_stock,get_weather,search]
llm_with_tools = llm.bind_tools(tools)

# -------------------
# 3. State
# -------------------
class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]

# -------------------
# 4. Nodes
# -------------------
def chat_node(state: ChatState):
    """LLM node that may answer or request a tool call."""
    messages = state["messages"]
    system_message = SystemMessage(
        content="You are a helpfull Ai agent you have access to various tools to fetch real time data. Use them when req"
    )
    response = llm_with_tools.invoke([system_message] + messages)
    return {"messages": [response]}

tool_node = ToolNode(tools)

# -------------------
# 5. Checkpointer (in-memory)
# -------------------
memory = MemorySaver()

# -------------------
# 6. Graph
# -------------------
graph = StateGraph(ChatState)
graph.add_node("chat_node", chat_node)
graph.add_node("tools", tool_node)

graph.add_edge(START, "chat_node")

graph.add_conditional_edges("chat_node", tools_condition)
graph.add_edge("tools", "chat_node")

chatbot = graph.compile(checkpointer=memory)

# -------------------
# 7. Simple usage example (CLI)
# -------------------
if __name__ == "__main__":
    print("Stock Bot with Tools (get_stock_price, purchase_stock)")
    print("Type 'exit' to quit.\n")

    # thread_id still works with MemorySaver (conversation kept in RAM)
    thread_id = "demo-thread"

    while True:
        user_input = input("You: ")
        if user_input.lower().strip() in {"exit", "quit"}:
            print("Goodbye!")
            break

        # Build initial state for this turn
        state = {"messages": [HumanMessage(content=user_input)]}

        for message_chunk, meta_data in chatbot.stream(
            state,
            config={"configurable": {"thread_id": thread_id}},
            stream_mode='messages'
        ):
            if isinstance(message_chunk, (AIMessage, AIMessageChunk)) and message_chunk.content:
                print(message_chunk.content, end="",flush = True)
        print("")