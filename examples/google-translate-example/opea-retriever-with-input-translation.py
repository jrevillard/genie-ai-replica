from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from google_translator import GoogleTranslator
import requests
import os

# Initialize FastAPI
app = FastAPI()

# Load Google API Key from environment variable
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise ValueError("Google API Key is missing. Set GOOGLE_API_KEY environment variable.")

# Initialize Google Translator
translator = GoogleTranslator(GOOGLE_API_KEY)

# Define the OPEA Retrieval API endpoint (replace with actual endpoint)
OPEA_RETRIEVER_URL = "https://opea.example.com/api/retrieve"

# Define request model
class QueryRequest(BaseModel):
    text: str
    source_language: str  # e.g., "id" (Indonesian), "jv" (Javanese), "su" (Sundanese)
    target_language: str = "en"  # Default to English for retrieval

@app.post("/retrieve")
async def retrieve_data(request: QueryRequest):
    """
    Pre-processes user input by translating it, retrieves data from OPEA, and translates response back.
    """
    try:
        # Step 1: Translate user query to English
        translated_query = translator.translate_text(request.text, target_language=request.target_language, source_language=request.source_language)

        # Step 2: Send translated query to OPEA's retrieval system
        opea_payload = {"query": translated_query}
        response = requests.post(OPEA_RETRIEVER_URL, json=opea_payload)

        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to retrieve data from OPEA.")

        retrieved_text = response.json().get("response", "")

        # Step 3: Translate OPEA's response back to the original language
        final_response = translator.translate_text(retrieved_text, target_language=request.source_language, source_language="en")

        return {"original_query": request.text, "translated_query": translated_query, "retrieved_text": retrieved_text, "final_response": final_response}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Run the microservice (for local development)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
