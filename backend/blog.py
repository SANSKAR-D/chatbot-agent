from pydantic_settings.sources.providers.gcp import google_auth_default
import operator
from dotenv import load_dotenv

load_dotenv()
from typing import TypedDict,List,Annotated,Literal,Optional
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph,START,END
from langgraph.types import Send
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage,HumanMessage
from langchain_tavily import TavilySearch

class Task(BaseModel):
    id : int
    title : str
    goal : str = Field(...,description="Write a detailed brief of the task in 2-3 sentences")
    bullets : List[str] = Field(...,description="3-5 bullet points describing the content")
    target_words : int = Field(...,description="Target words for this section")
    section_type : Literal["intro","body","conclusion"] = Field(...,description="Section type")
    tags: List[str] = Field(default_factory=list)
    requires_research: bool = Field(default=False)
    requires_citations: bool = Field(default=False)
    requires_code: bool = Field(default=False)

class Plan(BaseModel):
    tasks : List[Task]
    blog_title : str
    audience: str = Field(default="")
    tone: str = Field(default="")
    blog_kind: Literal['explainer', 'tutorial', 'news_roundup', 'comparison', 'system_design'] = Field(default="explainer")
    constraints: List[str] = Field(default_factory=list)

class RouterDecision(BaseModel):
    needs_research: bool
    mode: Literal['closed_book', 'hybrid', 'open_book']
    queries: List[str]

class EvidenceItem(BaseModel):
    title: str
    url: str
    published_at: Optional[str] = None
    snippet: Optional[str] = None
    source: Optional[str] = None

class EvidencePack(BaseModel):
    evidence: List[EvidenceItem]

class ImageSpec(BaseModel):
    placeholder: str
    filename: str
    alt: str
    caption: str
    prompt: str
    size: Literal['1024x1024', '1024x1536', '1536x1024']
    quality: Literal['low', 'medium', 'high']

class GlobalImagePlan(BaseModel):
    md_with_placeholders: str
    images: List[ImageSpec]

class State(TypedDict, total=False):
    topic : str
    feedback: Optional[str]
    router_decision: RouterDecision
    evidence: EvidencePack
    plan : Plan
    sections: Annotated[List[tuple[int, str]], operator.add]
    merged_md: str
    image_plan: GlobalImagePlan
    final : str

llm = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite",temperature=0)

ROUTER_SYSTEM = """You are a routing module for a technical blog planner.

Decide whether web research is needed BEFORE planning.

Modes:
- closed_book (needs_research=false):
  Evergreen topics where correctness does not depend on recent facts (concepts, fundamentals).
- hybrid (needs_research=true):
  Mostly evergreen but needs up-to-date examples/tools/models to be useful.
- open_book (needs_research=true):
  Mostly volatile, weekly roundups, "this week", "latest", rankings, pricing, policy/regulation.

If needs_research=true:
- Output 3-10 high-signal queries.
- Queries should be scoped and specific (avoid generic queries like just "AI" or "LLM").
- If user asked for "last week/this week/latest", reflect that constraint IN THE QUERIES.
"""

def router_node(state: State):
    topic = state["topic"]
    
    decision = llm.with_structured_output(RouterDecision).invoke([
        SystemMessage(content=ROUTER_SYSTEM),
        HumanMessage(content=f"Topic: {topic}")
    ])
    
    return {"router_decision": decision}

RESEARCH_SYSTEM = """You are a research synthesizer for technical writing.

Given raw web search results, produce a deduplicated list of EvidenceItem objects.

Rules:
- Only include items with a non-empty url.
- Prefer relevant + authoritative sources (company blogs, docs, reputable outlets).
- If a published date is explicitly present in the result payload, keep it as YYYY-MM-DD.
  If missing or unclear, set published_at=null. Do NOT guess.
- Keep snippets short.
- Deduplicate by URL.
"""

def research_node(state: State):
    queries = state["router_decision"].queries[:10]
    search_tool = TavilySearch(max_results=2)
    
    raw_results = []
    for q in queries:
        try:
            results = search_tool.invoke({"query": q})
            raw_results.extend(results)
        except Exception as e:
            print(f"Search failed for query '{q}': {e}")
            
    evidence_pack = llm.with_structured_output(EvidencePack).invoke([
        SystemMessage(content=RESEARCH_SYSTEM),
        HumanMessage(content=f"Raw Results:\n{raw_results}")
    ])
    
    return {"evidence": evidence_pack}

def orchestrator(state:State):
    evidence = state.get("evidence")
    evidence_str = f"Evidence from Research:\n{evidence.model_dump_json()}" if evidence else ""
    
    plan = llm.with_structured_output(Plan).invoke([
        SystemMessage(content="""
            You are a expert content planner and SEO specialist. Your goal is to create a comprehensive blog plan that ranks on Google.
            Blog Title Requirements:
            - Should be catchy, SEO-friendly, and under 60 characters
            - Must include the primary keyword naturally
            - Should be engaging and make people want to click

            Blog Section Requirements:
            - 3-4 sections depending on the topic
            - Each section should have a clear heading
            - Each section should be 300-500 words long
            - Each section should include the primary keyword naturally
            - Each section should be engaging and easy to read

            SEO Requirements:
            - Include primary keyword in title, headings, and body
            - Use LSI keywords naturally throughout the content
            - Include internal and external links
            - Optimize for search intent
            - Make content skimmable with short paragraphs and bullet points
            - Use H1, H2, and H3 headings appropriately
            - Target 800-1500 words for the entire blog
            Markdown Output Requirements:
            - Use proper Markdown formatting for headings, bold text, italics, etc.
            - Use bullet points for lists
            - Use numbered lists for steps or ordered items
            - Use blockquotes for quotes or highlighted text
            - Use code blocks for code snippets or technical terms
            - Use horizontal rules to separate sections
            - Use links with proper Markdown syntax
        """),
        HumanMessage(content=f"Topic: {state['topic']}\n\n{evidence_str}\n\nCreate a blog plan for this topic.")
    ])
    return {"plan" : plan}

def fanout(state:State):
    evidence = state.get("evidence")
    return [Send("worker",{"task" : task,"topic":state["topic"],"plan":state["plan"],"evidence":evidence}) for task in state['plan'].tasks]

def worker(payload: dict):
    task = payload["task"]
    topic = payload["topic"]
    plan = payload["plan"]
    evidence = payload.get("evidence")

    blog_title = plan.blog_title

    response = llm.invoke([
        SystemMessage(content="""
            Write only markdown content for this section based on the task.
            You already have the blog title and plan.

            Blogger Guidelines:
            - Target 300-500 words.
            - Match the tone of the previous sections.
            - Include subheadings (H2/H3) for structure.
            - Use short paragraphs (2-3 sentences).
            - Include the code snippet where needed for examples.
            - Include bullet points when listing items.
            - Insert internal links to other posts where natural.
            - Add 1-2 external links to authoritative sources.
            - Use bold text for key terms.
            - Write in a conversational, engaging style.
            - Check for readability (aim for a 7th-9th grade reading level).
            - Do not include any meta tags, placeholders, or notes.
            - End with the phrase "To sum up" only if it fits the conclusion.
            
        """),
        HumanMessage(content=(
            f"Blog Title: {blog_title}\n"
            f"Section: {task.title}\n"
            f"Section Type: {task.section_type}\n"
            f"Bullet Points: {task.bullets}\n"
            f"Target Words: {task.target_words}\n"
            f"Goal: {task.goal}\n"
            f"Topic: {topic}\n"
            f"Evidence Context: {evidence.model_dump_json() if evidence and task.requires_research else 'None'}\n"
            "Write only markdown content. Do not add extra explanations."
        ))
    ])
    
    content = response.content
    if isinstance(content, list):
        section_md = "".join(
            block if isinstance(block, str) else block.get("text", "")
            for block in content
        ).strip()
    else:
        section_md = content.strip()

    return {"sections" : [(task.id, section_md)]}

from pathlib import Path

def merge_content(state: State):
    plan = state["plan"]
    ordered_sections = [md for _, md in sorted(state["sections"], key=lambda x: x[0])]
    body = "\n\n".join(ordered_sections).strip()
    merged_md = f"# {plan.blog_title}\n\n{body}\n"
    return {"merged_md": merged_md}

DECIDE_IMAGES_SYSTEM = """You are an expert technical editor.
Decide if images/diagrams are needed for THIS blog.

Rules:
- Max 3 images total.
- Each image must materially improve understanding (diagram/flow/table-like visual).
- Insert placeholders exactly: [[IMAGE_1]], [[IMAGE_2]], [[IMAGE_3]].
- If no images needed: md_with_placeholders must equal input and images=[].
- Avoid decorative images; prefer technical diagrams with short labels.
Return strictly GlobalImagePlan.
"""

def decide_images(state: State):
    merged_md = state["merged_md"]
    
    image_plan = llm.with_structured_output(GlobalImagePlan).invoke([
        SystemMessage(content=DECIDE_IMAGES_SYSTEM),
        HumanMessage(content=f"Blog Draft:\n{merged_md}")
    ])
    
    return {"image_plan": image_plan}

import os
from huggingface_hub import InferenceClient

REFINE_SYSTEM = """You are a senior technical writer and blog editor.

Your task is to refine and update an existing full blog post based on user feedback.

STRICT WRITING RULES:
1. PRESERVE FULL LENGTH AND DEPTH: Do NOT truncate, summarize, or remove detailed technical sections from the existing blog post unless explicitly requested in the user's feedback.
2. INTEGRATE USER FEEDBACK: Incorporate all user feedback (e.g. adding new topics, expanding explanations, adding code examples, adjusting tone) directly into the appropriate sections of the post.
3. STRUCTURE & FORMATTING: Maintain clean Markdown structure with clear H1, H2, and H3 headings, code blocks, bold text, and bullet points.
4. IMAGE PLACEHOLDERS: Keep or adjust image placeholders like [[IMAGE_1]], [[IMAGE_2]] in natural positions where visual diagrams are helpful.
5. Output ONLY the updated complete Markdown document. Do not include introductory comments or meta-explanations.
"""

def refine_node(state: State):
    current_draft = state.get("final") or state.get("merged_md") or ""
    feedback = state.get("feedback") or ""
    topic = state.get("topic") or ""

    response = llm.invoke([
        SystemMessage(content=REFINE_SYSTEM),
        HumanMessage(content=(
            f"Original Topic: {topic}\n\n"
            f"User Feedback / Adjustments Required:\n{feedback}\n\n"
            f"Current Blog Post Draft:\n{current_draft}\n\n"
            "Produce the complete, fully updated Markdown blog post incorporating the feedback while maintaining full length, detailed sections, and high quality."
        ))
    ])
    
    content = response.content
    if isinstance(content, list):
        revised_md = "".join(block if isinstance(block, str) else block.get("text", "") for block in content).strip()
    else:
        revised_md = content.strip()

    return {"merged_md": revised_md}

import base64
import time
import requests

def generate_and_place_images(state: State):
    image_plan = state["image_plan"]
    
    final_md = image_plan.md_with_placeholders
    
    cf_account_id = os.environ.get("ACCOUNT_ID")
    cf_token = os.environ.get("CLOUDFLARE_TOKEN")
    hf_token = os.environ.get("HF_TOKEN")
    
    output_path = Path(__file__).parent / "blogs"
    output_path.mkdir(exist_ok=True)
    
    import re
    blog_title = state["plan"].blog_title if ("plan" in state and state["plan"]) else state.get("topic", "blog")
    safe_title = re.sub(r'[^\w\s-]', '', blog_title.lower())
    base_filename = safe_title.replace(" ", "-")
    
    ts = int(time.time())
    
    for spec in image_plan.images:
        image_filename = f"{base_filename}-{spec.filename}"
        if not image_filename.endswith('.png'):
            image_filename += '.png'
            
        image_path = output_path / image_filename
        generated = False
        
        # Primary Image Generation: Cloudflare Workers AI API
        if cf_account_id and cf_token:
            model_name = os.environ.get("CF_IMAGE_MODEL")
            try:
                print(f"Generating image via Cloudflare Workers AI ({model_name}) for prompt: {spec.prompt}")
                cf_url = f"https://api.cloudflare.com/client/v4/accounts/{cf_account_id}/ai/run/{model_name}"
                res = requests.post(
                    cf_url,
                    headers={"Authorization": f"Bearer {cf_token}", "Content-Type": "application/json"},
                    json={"prompt": spec.prompt},
                    timeout=45
                )
                if res.status_code == 200:
                    content_type = res.headers.get("content-type", "")
                    if "application/json" in content_type:
                        data = res.json()
                        img_b64 = data.get("result", {}).get("image")
                        if img_b64:
                            image_path.write_bytes(base64.b64decode(img_b64))
                            generated = True
                            print(f"Successfully saved Cloudflare Workers AI image: {image_filename}")
                    else:
                        image_path.write_bytes(res.content)
                        generated = True
                        print(f"Successfully saved binary image from Cloudflare Workers AI: {image_filename}")
                else:
                    print(f"Cloudflare Workers AI status {res.status_code}: {res.text}")
            except Exception as e:
                print(f"Error generating Cloudflare Workers AI image {image_filename}: {e}")
        
        if generated or image_path.exists():
            md_image = f"![{spec.alt}](http://127.0.0.1:8000/blogs/{image_filename}?v={ts})\n*{spec.caption}*"
            final_md = final_md.replace(spec.placeholder, md_image)
        else:
            # If generation failed or skipped, clean up placeholder so no broken image appears
            final_md = final_md.replace(spec.placeholder, "")
    
    md_filename = f"{base_filename}.md"
    (output_path / md_filename).write_text(final_md, encoding="utf-8")
    
    return {"final": final_md}

reducer_graph_builder = StateGraph(State)
reducer_graph_builder.add_node("merge_content", merge_content)
reducer_graph_builder.add_node("decide_images", decide_images)
reducer_graph_builder.add_node("generate_and_place_images", generate_and_place_images)
reducer_graph_builder.add_edge(START, "merge_content")
reducer_graph_builder.add_edge("merge_content", "decide_images")
reducer_graph_builder.add_edge("decide_images", "generate_and_place_images")
reducer_graph_builder.add_edge("generate_and_place_images", END)
reducer_subgraph = reducer_graph_builder.compile()

def router_edge(state: State):
    decision = state.get("router_decision")
    if decision and decision.needs_research:
        return "research_node"
    return "orchestrator"

def entry_router(state: State):
    if state.get("feedback") and (state.get("final") or state.get("merged_md")):
        return "refine_node"
    return "router_node"

graph = StateGraph(State)
graph.add_node("router_node", router_node)
graph.add_node("research_node", research_node)
graph.add_node("orchestrator", orchestrator)
graph.add_node("worker", worker)
graph.add_node("refine_node", refine_node)
graph.add_node("reducer", reducer_subgraph)

graph.add_conditional_edges(START, entry_router, ["refine_node", "router_node"])
graph.add_conditional_edges("router_node", router_edge, ["research_node", "orchestrator"])
graph.add_edge("research_node", "orchestrator")
graph.add_conditional_edges("orchestrator", fanout, ["worker"])
graph.add_edge("worker", "reducer")
graph.add_edge("refine_node", "reducer")
graph.add_edge("reducer", END)

