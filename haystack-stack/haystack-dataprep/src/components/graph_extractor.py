import json
from typing import List
from haystack import component, Document
from haystack.dataclasses import ChatMessage
from haystack.utils import Secret

# Use OpenAI instead of Gemini to avoid free-tier rate limits
from haystack.components.generators.chat import OpenAIChatGenerator

@component
class GraphExtractor:
    """
    Reads text chunks and uses the llm to extract Medical Entities and Relationships into JSON.
    """
    def __init__(self):
        # 1. Load the Jinja prompt we created in Step 2
        with open("src/prompts/graph_extraction.jinja2", "r", encoding="utf-8") as f:
            self.prompt_template = f.read()

        # 2. Initialize OpenAI LLM (gpt-4o-mini — fast, cheap, paid key available)
        self.llm = OpenAIChatGenerator(
            model="gpt-4o-mini",
            api_key=Secret.from_env_var("OPENAI_API_KEY"),
        )

    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document]):
        print(f"🧠 Extracting Graph Data for {len(documents)} chunks...")
        
        for i, doc in enumerate(documents):
            print(f"  -> ⏳ Sending chunk {i+1}/{len(documents)} to OpenAI...", flush=True)
            
            # Inject the document's text into our prompt template
            prompt = self.prompt_template.replace("{{ document.content }}", doc.content)
            
            try:
                # Call Gemini
                #res = self.llm.run(parts=[prompt])
                #llm_output = res["replies"][0]
                messages = [ChatMessage.from_user(prompt)]
                res = self.llm.run(messages=messages)
                
                llm_output = res["replies"][0].text
                
                # Clean up the output (in case Gemini wraps it in ```json ... ``` markdown)
                llm_output = llm_output.replace("```json", "").replace("```", "").strip()
                
                # Parse the JSON string into a Python dictionary
                graph_data = json.loads(llm_output)
                
                entities_found = len(graph_data.get("entities", []))
                print(f"  -> ✅ Success! Extracted {entities_found} entities.", flush=True)
                
                # Attach the extracted entities and relationships to the document's metadata!
                doc.meta["graph_data"] = graph_data
                
            except Exception as e:
                print(f"⚠️ Failed to extract graph data for a chunk. Skipping. Error: {e}")
                # Fallback so the pipeline doesn't crash
                doc.meta["graph_data"] = {"entities": [], "relationships": []}
        
        print("🧠 Graph Extraction Complete! Passing to Database Writer...", flush=True)
        return {"documents": documents}