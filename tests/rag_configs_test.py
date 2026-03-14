import requests
import time
import pandas as pd
import itertools
from pathlib import Path
import concurrent.futures
import threading
import random

# --- Short Test for Testing Logic Validation ---
SMOKE_TEST_MODE = False #True  # Set to False for the full production run
SAMPLE_SIZE = 1

# Target the Kong gateway serving ChatQnA, or 8888 directly
TARGET_URL = "http://localhost:8888/v1/chatqna"
RESULTS_FILE = "genieai_rag_config_test_results_third_run.csv"
MAX_WORKERS = 8 if not SMOKE_TEST_MODE else 1  # Force 1 worker in test mode for cleaner logs

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
# QUESTIONS = ["What is GENIE.AI and what approach does it adopt for retrieval?"]

# PARAMETER CONFIGURATIONS FOR TESTING
# see parameters_for_testing/params_for_testing for further detail
def generate_configurations():
    print("Building MASSIVE configuration grid...")
    
    # Retriever Base Params
    ret_params = {
        "k": [5, 10, 30],
        "fetch_k": [10, 30],
        "search_start": ['chunk', 'edge', 'node']
    }
    r_keys, r_values = zip(*ret_params.items())
    base_ret_combos = [dict(zip(r_keys, v)) for v in itertools.product(*r_values)]
    
    traversal_combos = []
    for bc in base_ret_combos:
        # Branch 1: Traversal Disabled
        tc_false = bc.copy()
        tc_false["enable_traversal"] = "false"
        tc_false["traversal_score_threshold"] = 0.5
        traversal_combos.append(tc_false)
        
        # Branch 2: Traversal Enabled
        for depth in [1, 2]:
            for ret in [2, 5]:
                for thresh in [0.5, 0.7]:
                    tc_true = bc.copy()
                    tc_true["enable_traversal"] = "true"
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
            fc["top_n"] = top_n
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
            df.to_csv(RESULTS_FILE, sep='|', index=False)
        else:
            df.to_csv(RESULTS_FILE, sep='|', mode='a', header=False, index=False)

def wait_for_service(url, timeout_sec=180):
    print(f"Polling mega-service at {url} for readiness...")
    start_t = time.time()
    
    while time.time() - start_t < timeout_sec:
        try:
            response = requests.post(
                url, 
                json={"messages": [{"role": "user", "content": "ping"}], "stream": False}, 
                timeout=5
            )
            response.raise_for_status()
            print(f"Service at {url} is UP and accepting queries.")
            return True
        except requests.exceptions.RequestException:
            time.sleep(5)
            
    raise RuntimeError(f"Service at {url} failed to initialize within {timeout_sec} seconds.")

def execute_test(config_id, config, q_idx, question):
    start_t = time.time()
    
    payload = {
        "messages": [{"role": "user", "content": question}],
        "context": {'categoryLabel': 'General', 'serviceLabels': []},
        "stream": False,
        "user_id":"0001",
        **config
    }
    
    if SMOKE_TEST_MODE:
        print(f"\n--- [VERBOSE] Config {config_id}, Q{q_idx} ---")
        print(f"Payload: {payload}")
    
    try:
        # 180s timeout accounts for peak hardware contention
        response = requests.post(TARGET_URL, json=payload, timeout=180)
        total_latency = time.time() - start_t
        
        if SMOKE_TEST_MODE:
            print(f"Status Code: {response.status_code} | Latency: {total_latency:.2f}s")
        
        if response.status_code == 200:
            resp_json = response.json()
            
            answer_text = resp_json.get("response", "")
            if not answer_text:
                answer_text = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "ERROR: Empty LLM content returned.")
            
            if SMOKE_TEST_MODE:
                print(f"Answer snippet: {answer_text[:150]}...")
                
            return save_and_return(config_id, q_idx, question, config, 200, total_latency, answer_text)
        else:
            if SMOKE_TEST_MODE:
                print(f"Gateway Error: {response.text}")
            return save_and_return(config_id, q_idx, question, config, response.status_code, total_latency, f"Gateway Error: {response.text}")
            
    except requests.exceptions.Timeout as e:
        total_latency = time.time()-start_t
        if SMOKE_TEST_MODE:
            print(f"Timeout Error: {str(e)}")
        return save_and_return(config_id, q_idx, question, config, 504, total_latency, f"TImeout Error: {str(e)}")

    except requests.exceptions.RequestException as e:
        if SMOKE_TEST_MODE:
            print(f"Network Error: {str(e)}")
        return save_and_return(config_id, q_idx, question, config, 500, time.time() - start_t, f"Network Error: {str(e)}")

def save_and_return(c_id, q_id, q_text, config, status, latency, answer):
    
    # re-formatting the LLM response and question text to faciliate parsing later
    clean_answer = " ".join(answer.split())
    clean_question = " ".join(q_text.split())

    result_row = {
        "config_id": c_id,
        "question_id": q_id,
        "question": clean_question,
        **config,
        "status_code": status,
        "latency_sec": round(latency, 2),
        "answer_length": len(clean_answer),
        "answer": clean_answer 
    }
    save_result(result_row)
    return c_id, q_id, status, latency

def main():
    configurations = generate_configurations()
    
    if SMOKE_TEST_MODE:
        sample_size = min(SAMPLE_SIZE, len(configurations))
        configurations = random.sample(configurations, sample_size)
        print(f"\n[!] TEST MODE ENABLED: Randomly sampled {sample_size} configurations.")
        print("[!] Threading reduced to 1 worker for sequential, verbose logging.\n")
    
    # Hold execution until the mega-service responds
    wait_for_service(TARGET_URL)
    
    print(f"\nInitiating End-to-End ChatQnA Executor with {MAX_WORKERS} workers...")
    
    tasks = []
    for i, config in enumerate(configurations):
        for q_idx, question in enumerate(QUESTIONS):
            tasks.append((i + 1, config, q_idx + 1, question))
    
    total_tasks = len(tasks)
            
    # Deploy threaded workers
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(execute_test, *t): t for t in tasks}
        
        for count, future in enumerate(concurrent.futures.as_completed(futures), 1):

            task = futures[future]
            config_id, config, q_id, question = task

            try:
                c_id, q_id_result, status, latency = future.result()
                if status == 200:
                    print(f"[{count}/{total_tasks}] Success - Config {c_id}, Q{q_id_result} ({latency:.2f}s)")
                else:
                    print(f"[{count}/{len(tasks)}] FAILED (HTTP {status}) - Config {config_id}, Q{q_id} ({latency:.2f}s), VALUES: {config}")
            except Exception as e:
                print(f"[{count}/{len(tasks)}] Thread crashed: {str(e)}")

    print("\nEnd-to-End Testing Matrix Complete. \nGENIE.AI answers are ready for review.")

if __name__ == "__main__":
    main()
