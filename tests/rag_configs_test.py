# Script for automated RAG param testing 
# ahead of GENIE.AI 1.0 legendary release


import subprocess
import requests
import time
import pandas as pd
import os
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
# Basically, trying to replicate different branches here 
def generate_configurations():
    print("Building MASSIVE configuration grid...")
    
    # Base parameters that always apply
    base_params = {
        "RETRIEVER_ARANGO_K": [5, 10, 30],
        "RETRIEVER_ARANGO_FETCH_K": [5, 10, 30],
        "RETRIEVER_ARANGO_SCORE_THRESHOLD": [0.5, 0.7, 0.9],
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
        # not sure if nested FOR loops are optimal here, but should do the job
        for depth in [1, 2, 3]:
            for ret in [2, 3, 5]:
                for st in [0.5, 0.7, 0.9]:
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
def query_rag(question):
    # Sends the question to Kong gateway to account for the network overhead
    # Also to help control for potential gateway errors (if any)
    
    payload = {"messages": question, "stream": False} # <<< NEED TO CHECK THIS
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

    # saving a copy just in case
    base_env = os.environ.copy()
    
    for i, config in enumerate(configurations):
        print(f"\n--- [Config {i+1}/{len(configurations)}] ---")
        
        # 1. Update Environment
        current_env = {**base_env, **{k: str(v) for k, v in config.items()}}
        
        # 2. Restart ONLY the affected containers to save time
        print("Restarting chatqna, retriever, and reranker...")
        # ################################################################################
        # DAVID, please review this:
        subprocess.run([
            "sudo", "docker-compose", "up", "-d", 
            "chatqna-xeon-backend-server", 
            "retriever-arango-service", 
            "reranker"
        ], env=current_env, check=True, stdout=subprocess.DEVNULL)
        # ################################################################################
        
        # 3. Wait for internal Python services to initialize
        time.sleep(15) 
        
        # 4. Run the questions
        for q_idx, question in enumerate(QUESTIONS):
            print(f"  -> Asking Q{q_idx + 1}...")
            
            # Send a quick throwaway request on Q1 to warm up caches (optional but recommended)
            if q_idx == 0:
                requests.post(TARGET_URL, json={"messages": "ping", "stream": False}, timeout=10)
            
            answer, latency, status = query_rag(question)
            
            # 5. Save immediately
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



