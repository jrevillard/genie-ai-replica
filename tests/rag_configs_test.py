# Script for automated RAG param testing 
# ahead of GENIE.AI 1.0 legendary release

import requests
import time
import pandas as pd
import itertools
from pathlib import Path

# --- 1. CONFIGURATION ---
TARGET_URL = "http://localhost:8010/v1/chatqna"
RESULTS_FILE = "rag_testing_results.csv"

# TEST QUESTIONS 
# see parameters_for_testing/methodology for further detail
QUESTIONS = [
    "What is the altitude range and average monthly rainfall of the Masai Mara National Reserve?",
    "I am a non-resident adult planning a safari for August 2025. Compare the daily park entry fees (including any applicable concession fees) for staying inside the Masai Mara National Reserve versus staying inside the Serengeti National Park.",
    "Why is the risk of contracting Malaria considered very low in the Serengeti National Park, and what specific preventative measures does the document still recommend tourists take?",
    "What technique is used to prevent the Large Language Model (LLM) from experiencing 'drift' during label assignment, and what is the exact financial cost of running this LLM per 1,000 queries?",
    "Based on the documentation, contrast the specific shortcomings of conventional vector-only RAG pipelines with the corresponding benefits introduced by this hybrid approach. Be sure to address issues of interpretability, precision, and domain adaptability."
]

# TEST PARAMETERS
# see parameters_for_testing/params_for_testing for further detail

# Function to help generate combinations that account for conditionality 
def generate_configurations():
    print("Building MASSIVE configuration grid...")
    
    # Base parameters that always apply
    base_params = {
        "RETRIEVER_ARANGO_K": [20, 30, 50],
        "RETRIEVER_ARANGO_FETCH_K": [50],
        "RETRIEVER_ARANGO_SCORE_THRESHOLD": [0.7, 0.9],
        "RETRIEVER_ARANGO_SEARCH_START": ['chunk', 'edge', 'node'],
    }
    
    keys, values = zip(*base_params.items())
    base_combos = [dict(zip(keys, v)) for v in itertools.product(*values)]
    
    # Params conditional on traversal logic value
    traversal_combos = []
    for bc in base_combos:
        # Tree branch when traversal is disabled
        tc_false = bc.copy()
        tc_false["RETRIEVER_ARANGO_TRAVERSAL_ENABLED"] = 'false'
        tc_false["RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH"] = 1      # Dummy default
        tc_false["RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED"] = 2   # Dummy default
        tc_false["RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD"] = 0.5 # Dummy default
        traversal_combos.append(tc_false)
        
        # Tree branch when traversal is enabled 
        for depth in [1, 2]:
            for ret in [2, 3, 5]:
                for st in [0.7, 0.9]:
                    tc_true = bc.copy()
                    tc_true["RETRIEVER_ARANGO_TRAVERSAL_ENABLED"] = 'true'
                    tc_true["RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH"] = depth
                    tc_true["RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED"] = ret
                    tc_true["RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD"] = st
                    traversal_combos.append(tc_true)
                    
    # Reranking logic
    final_combos = []
    for tc in traversal_combos:
        # Tree branch when strategy is slice
        for top_n in [3, 5, 10]:
            fc = tc.copy()
            fc["RERANKING_STRATEGY"] = 'slice'
            fc["RERANKER_TOP_N"] = top_n
            fc["RERANKING_THRESHOLD"] = 0.5 # Dummy default
            final_combos.append(fc)
            
        # Tree branch when strategy is threshold 
        for th in [0.5, 0.7, 0.9]:
            fc = tc.copy()
            fc["RERANKING_STRATEGY"] = 'threshold'
            fc["RERANKER_TOP_N"] = 5 # Dummy default
            fc["RERANKING_THRESHOLD"] = th
            final_combos.append(fc)
            
        # Tree branch when strategy is knee threshold 
        fc = tc.copy()
        fc["RERANKING_STRATEGY"] = 'knee_threshold'
        fc["RERANKER_TOP_N"] = 5 # Dummy default value
        fc["RERANKING_THRESHOLD"] = 0.5 # Dummy default value
        final_combos.append(fc)
        
    print(f"Total configurations generated: {len(final_combos)}")
    return final_combos


# --- 3. HELPER FUNCTIONS ---
# saving to csv
def save_result(data_dict):
    df = pd.DataFrame([data_dict])

    if not Path(RESULTS_FILE).is_file():
        df.to_csv(RESULTS_FILE, index=False)
    else:
        df.to_csv(RESULTS_FILE, mode='a', header=False, index=False)

# sending payload to the ChatQnA
def query_rag(question, config):
    # Sends the question and the configuration payload directly to the API
    payload = {
        "messages": question, 
        "stream": False,
        "rag_params": config  
    }
    
    try:
        start_t = time.time()
        response = requests.post(TARGET_URL, json=payload, timeout=90)
        duration = time.time() - start_t
        
        if response.status_code == 200:
            ans = response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            return ans, duration, response.status_code
        else:
            return f"HTTP Error {response.status_code}", duration, response.status_code
    except Exception as e:
        return f"Request Failed: {str(e)}", 0, 500

# MAIN
def main():
    configurations = generate_configurations()
    
    for i, config in enumerate(configurations):
        print(f"\n--- [Config {i+1}/{len(configurations)}] ---")
        
        Run the questions
        for q_idx, question in enumerate(QUESTIONS):
            print(f"  -> Asking Q{q_idx + 1}...")
            
            Send a quick throwaway request ONLY on the very first run to warm up caches
            if i == 0 and q_idx == 0:
                requests.post(TARGET_URL, json={"messages": "ping", "rag_params": config, "stream": False}, timeout=10)
            
            # Pass the config to the query function
            answer, latency, status = query_rag(question, config)
            
            # Save results
            result_row = {
                "config_id": i + 1,
                **config,
                "question_id": q_idx + 1,
                "question": question,
                "status_code": status,
                "latency_sec": round(latency, 2),
                "answer": answer
            }
            save_result(result_row)
            
            print(f"     Completed in {latency:.2f}s")

if __name__ == "__main__":
    main()