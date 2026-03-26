import aiohttp
import asyncio
import time
import pandas as pd
import itertools
from pathlib import Path
import random
from datetime import datetime

# --- Short Test for Testing Logic Validation ---
SMOKE_TEST_MODE = False
SAMPLE_SIZE = 1
TARGET_SMOKE_TEST = False

MAX_CONCURRENT_REQUESTS = 5

TARGET_TEST_CONFIGS = [
    {
        'k': 30,
        'fetch_k': 30,
        'search_start': 'chunk',
        'enable_traversal': 'true',
        'traversal_max_depth': 2,
        'traversal_max_returned': 5,
        'traversal_score_threshold': 0.7,
        'reranking_strategy': 'knee_threshold',
        'reranker_top_n': 5,
        'reranking_threshold': 0.0
    }
]

TARGET_URL = "http://localhost:8888/v1/chatqna"
RESULTS_FILE = "genieai_rag_config_test_results_async_run.csv"

DEFAULT_CONFIGS = {
    'k': 10,
    'fetch_k': 20,
    'search_start': 'chunk',
    'enable_traversal': 'true',
    'traversal_max_depth': 1,
    'traversal_max_returned': 3,
    'traversal_score_threshold': 0.7,
    'reranking_strategy': 'threshold',
    'reranker_top_n': 2,
    'reranking_threshold': 0.75
}


def print_time_stamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


QUESTIONS = [
    "What is the altitude range and average monthly rainfall of the Masai Mara National Reserve?",
    "I am a non-resident adult planning a safari for August 2025. Compare the daily park entry fees (including any applicable concession fees) for staying inside the Masai Mara National Reserve versus staying inside the Serengeti National Park.",
    "Why is the risk of contracting Malaria considered very low in the Serengeti National Park, and what specific preventative measures does the document still recommend tourists take?",
    "What technique is used to prevent the Large Language Model (LLM) from experiencing 'drift' during label assignment, and what is the exact financial cost of running this LLM per 1,000 queries?",
    "Based on the documentation, contrast the specific shortcomings of conventional vector-only RAG pipelines with the corresponding benefits introduced by this hybrid approach. Be sure to address issues of interpretability, precision, and domain adaptability."
]


def generate_configurations():

    print(f"[{print_time_stamp()}] Building MASSIVE configuration grid...")

    ret_params = {
        "k": [5, 15, 30],
        "fetch_k": [30, 50],
        "search_start": ['chunk', 'edge', 'node']
    }

    r_keys, r_values = zip(*ret_params.items())
    base_ret_combos = [dict(zip(r_keys, v)) for v in itertools.product(*r_values)]

    traversal_combos = []

    for bc in base_ret_combos:

        tc_false = bc.copy()
        tc_false["enable_traversal"] = "false"
        tc_false["traversal_max_depth"] = 1
        tc_false["traversal_max_returned"] = 1
        tc_false["traversal_score_threshold"] = 0.5
        traversal_combos.append(tc_false)

        for depth in [1, 2]:
            for ret in [2, 5]:
                for thresh in [0.5, 0.7]:
                    tc_true = bc.copy()
                    tc_true["enable_traversal"] = "true"
                    tc_true["traversal_max_depth"] = depth
                    tc_true["traversal_max_returned"] = ret
                    tc_true["traversal_score_threshold"] = thresh
                    traversal_combos.append(tc_true)

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
            fc["top_n"] = 1
            fc["reranking_threshold"] = thresh
            final_combos.append(fc)

        fc = tc.copy()
        fc["reranking_strategy"] = "knee_threshold"
        fc["top_n"] = 1
        fc["reranking_threshold"] = 0.0
        final_combos.append(fc)

    print(f"[{print_time_stamp()}] Total configurations generated: {len(final_combos)}")

    return final_combos


def save_result(data_dict):

    df = pd.DataFrame([data_dict])

    if not Path(RESULTS_FILE).is_file():
        df.to_csv(RESULTS_FILE, sep='|', index=False)
    else:
        df.to_csv(RESULTS_FILE, sep='|', mode='a', header=False, index=False)


async def wait_for_service(session, url, timeout_sec=180):

    print(f"[{print_time_stamp()}] Polling mega-service at {url} for readiness...")

    start_t = time.time()

    while time.time() - start_t < timeout_sec:

        try:

            payload = {
                "messages": [{"role": "user", "content": "ping"}],
                "stream": False,
                **DEFAULT_CONFIGS
            }

            async with session.post(url, json=payload, timeout=5) as response:

                if response.status == 200:
                    print(f"[{print_time_stamp()}] Service at {url} is UP and accepting queries.")
                    return True

        except Exception:
            pass

        await asyncio.sleep(5)

    raise RuntimeError(f"[{print_time_stamp()}] Service failed to initialize.")


async def execute_test(session, semaphore, config_id, config, q_idx, question):

    async with semaphore:

        start_t = time.time()

        print(f"[{print_time_stamp()}] Config {config_id}, Q{q_idx} START", end=" ... ", flush=True)

        payload = {
            "messages": [{"role": "user", "content": question}],
            "context": {'categoryLabel': 'General', 'serviceLabels': []},
            "stream": False,
            "user_id": "0001",
            **config
        }

        try:

            async with session.post(TARGET_URL, json=payload, timeout=210) as response:

                total_latency = time.time() - start_t

                if response.status == 200:

                    resp_json = await response.json()

                    print(f"[{print_time_stamp()}] Config {config_id}, Q{q_idx} COMPLETED ({total_latency:.2f}s)")

                    answer_text = resp_json.get("response", "")

                    if not answer_text:
                        answer_text = resp_json.get("choices", [{}])[0].get("message", {}).get("content", "")

                    return save_and_return(config_id, q_idx, question, config, 200, total_latency, answer_text)

                else:

                    text = await response.text()

                    return save_and_return(config_id, q_idx, question, config, response.status, total_latency, text)

        except asyncio.TimeoutError:

            total_latency = time.time() - start_t

            print(f"[{print_time_stamp()}] Config {config_id}, Q{q_idx} FAILED - Timeout Error")

            return save_and_return(config_id, q_idx, question, config, 504, total_latency, "Timeout Error")

        except Exception as e:

            print(f"[{print_time_stamp()}] Config {config_id}, Q{q_idx} FAILED - Network Error")

            return save_and_return(config_id, q_idx, question, config, 500, time.time() - start_t, str(e))


def save_and_return(c_id, q_id, q_text, config, status, latency, answer):

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


async def run_tests(tasks):

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    timeout = aiohttp.ClientTimeout(total=300)

    async with aiohttp.ClientSession(timeout=timeout) as session:

        await wait_for_service(session, TARGET_URL)

        print(f"\n[{print_time_stamp()}] Initiating End-to-End ChatQnA Executor with {MAX_CONCURRENT_REQUESTS} concurrent requests...")

        coroutines = [
            execute_test(session, semaphore, *task)
            for task in tasks
        ]

        total_tasks = len(tasks)

        count = 0

        for future in asyncio.as_completed(coroutines):

            count += 1

            try:

                c_id, q_id_result, status, latency = await future

                if status == 200:
                    print(f"\n[{print_time_stamp()}]          [{count}/{total_tasks}] Success - Config {c_id}, Q{q_id_result} ({latency:.2f}s)")
                else:
                    print(f"\n[{print_time_stamp()}]          [{count}/{total_tasks}] FAILED (HTTP {status})")

            except Exception as e:

                print(f"\n[{print_time_stamp()}]          [{count}/{total_tasks}] Task crashed: {str(e)}")


def main():

    configurations = generate_configurations()

    if SMOKE_TEST_MODE:

        if TARGET_SMOKE_TEST:
            configurations = TARGET_TEST_CONFIGS
            print(f"\n[!] TARGETED SMOKE TEST ENABLED")

        else:
            configurations = random.sample(configurations, min(SAMPLE_SIZE, len(configurations)))
            print(f"\n[!] TEST MODE ENABLED")

    tasks = []

    for i, config in enumerate(configurations):
        for q_idx, question in enumerate(QUESTIONS):
            tasks.append((i + 1, config, q_idx + 1, question))

    asyncio.run(run_tests(tasks))

    print(f"\n[{print_time_stamp()}] End-to-End Testing Matrix Complete.\nGENIE.AI answers are ready for review.")


if __name__ == "__main__":
    main()