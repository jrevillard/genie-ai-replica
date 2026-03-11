import requests
import time
import pandas as pd
import itertools
from pathlib import Path
import concurrent.futures
import threading

# --- CONFIGURATION ---
# Target the Kong gateway serving ChatQnA, or 8888 directly
TARGET_URL = "http://localhost:8010/v1/chatqna"
RESULTS_FILE = "genie_ai_hybrid_rag_results.csv"
MAX_WORKERS = 8

csv_lock = threading.Lock()

# TEST QUERIES 
# see parameters_for_testing/methodology for further detail
QUESTIONS = [
    "What is the altitude range and average monthly rainfall of the Masai Mara National Reserve?",
    "I am a non-resident adult planning a safari for August 2025. Compare the daily park entry fees (including any applicable concession fees) for staying inside the Masai Mara National Reserve versus staying inside the Serengeti National Park.",
    "Why is the risk of contracting Malaria considered very low in the Serengeti National Park, and what specific preventative measures does the document still recommend tourists take?",
    "What technique is used to prevent the Large Language Model (LLM) from experiencing 'drift' during label assignment, and what is the exact financial cost of running this LLM per 1,000 queries?",
    "Based on the documentation, contrast the specific shortcomings of conventional vector-only RAG pipelines with the corresponding benefits introduced by this hybrid approach. Be sure to address issues of interpretability, precision, and domain adaptability."
]

# PARAMETER CONFIGURATIONS FOR TESTING
# see parameters_for_testing/params_for_testing for further detail
def generate_configurations():
    print("Building MASSIVE configuration grid...")
    
    # Retriever Base Params
    ret_params = {
        "k": [5, 10, 30],
        "fetch_k": [10, 30],
        "search_start": ['chunk', 'edge']
    }
    r_keys, r_values = zip(*ret_params.items())
    base_ret_combos = [dict(zip(r_keys, v)) for v in itertools.product(*r_values)]
    
    traversal_combos = []
    for bc in base_ret_combos:
        # Branch 1: Traversal Disabled
        tc_false = bc.copy()
        tc_false["enable_traversal"] = False
        tc_false["traversal_score_threshold"] = 0.5
        traversal_combos.append(tc_false)
        
        # Branch 2: Traversal Enabled
        for depth in [1, 2]:
            for ret in [2, 5]:
                for thresh in [0.5, 0.7]:
                    tc_true = bc.copy()
                    tc_true["enable_traversal"] = True
                    tc_true["traversal_max_depth"] = depth
                    tc_true["traversal_max_returned"] = ret
                    tc_true["traversal_score_threshold"] = thresh
                    traversal_combos.append(tc_true)

    # Reranker Multiplier
    final_combos = []
    for tc in traversal_combos:
        for top_n in [3, 5]:
            fc = tc.copy()
            fc["reranking_strategy"] = "slice"
            fc["reranker_top_n"] = top_n
            fc["reranking_threshold"] = 0.0 
            final_combos.append(fc)
            
        for thresh in [0.5, 0.7]:
            fc = tc.copy()
            fc["reranking_strategy"] = "threshold"
            fc["reranker_top_n"] = 5 
            fc["reranking_threshold"] = thresh
            final_combos.append(fc)
            
        fc = tc.copy()
        fc["reranking_strategy"] = "knee_threshold"
        fc["reranker_top_n"] = 5 
        fc["reranking_threshold"] = 0.0 
        final_combos.append(fc)

    print(f"Total configurations generated: {len(final_combos)}")
    return final_combos

def save_result(data_dict):
    df = pd.DataFrame([data_dict])
    with csv_lock:
        if not Path(RESULTS_FILE).is_file():
            df.to_csv(RESULTS_FILE, index=False)
        else:
            df.to_csv(RESULTS_FILE, mode='a', header=False, index=False)

def wait_for_service(url, timeout_sec=300):
    print(f"Polling mega-service at {url} for readiness...")
    start_t = time.time()
    
    while time.time() - start_t < timeout_sec:
        try:
            requests.post(url, json={"messages": "ping", "stream": False}, timeout=5)
            print(f"Service at {url} is UP and accepting queries.")
            return True
        except requests.exceptions.RequestException:
            time.sleep(5)
            
    raise RuntimeError(f"Service at {url} failed to initialize within {timeout_sec} seconds.")

def execute_test(config_id, config, q_idx, question):
    start_t = time.time()
    
    payload = {
        "messages": question,
        "stream": False,
        **config
    }
    
    try:
        # 120s timeout accounts for peak hardware contention when 8 queries hit vLLM/Arango simultaneously
        response = requests.post(TARGET_URL, json=payload, timeout=120)
        total_latency = time.time() - start_t
        
        if response.status_code == 200:
            # Parsing the JSON by ChatQnA
            resp_json = response.json()
            
            answer_text = resp_json.get("response", "")
            if not answer_text:
                answer_text = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "ERROR: Empty LLM content returned.")
                
            return save_and_return(config_id, q_idx, question, config, 200, total_latency, answer_text)
        else:
            return save_and_return(config_id, q_idx, question, config, response.status_code, total_latency, f"Gateway Error: {response.text}")
            
    except requests.exceptions.RequestException as e:
        return save_and_return(config_id, q_idx, question, config, 500, time.time() - start_t, f"Network/Timeout Error: {str(e)}")

def save_and_return(c_id, q_id, q_text, config, status, latency, answer):
    result_row = {
        "config_id": c_id,
        "question_id": q_id,
        "question": q_text,
        **config,
        "status_code": status,
        "latency_sec": round(latency, 2),
        "answer": answer 
    }
    save_result(result_row)
    return c_id, q_id, status, latency

def main():
    configurations = generate_configurations()
    
    # Hold execution until the mega-service responds
    wait_for_service(TARGET_URL)
    
    print(f"\nInitiating End-to-End ChatQnA Executor with {MAX_WORKERS} workers...")
    
    tasks = []
    for i, config in enumerate(configurations):
        for q_idx, question in enumerate(QUESTIONS):
            tasks.append((i + 1, config, q_idx + 1, question))
            
    # Deploy threaded workers
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(execute_test, *t): t for t in tasks}
        
        for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                c_id, q_id, status, latency = future.result()
                if status == 200:
                    print(f"[{count}/{len(tasks)}] Success - Config {c_id}, Q{q_id} ({latency:.2f}s)")
                else:
                    print(f"[{count}/{len(tasks)}] FAILED (HTTP {status}) - Config {c_id}, Q{q_id} ({latency:.2f}s)")
            except Exception as e:
                print(f"[{count}/{len(tasks)}] Thread crashed: {str(e)}")

    print("\nEnd-to-End Testing Matrix Complete. LLM Answers are ready for tester review.")

if __name__ == "__main__":
    main()
    