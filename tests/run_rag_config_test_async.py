# Port of upstream GenieAI tests/run_rag_config_test_async.py (upstream/main
# 672baab5; identical to v2.0.1) — DEC-37: replaces the stale local sync sweep
# (tests/rag_configs_test.py, deleted). Sprint tracker: sprint/plan_10_17.md N.3.
#
# DEVIATIONS vs upstream (all from the N.1 map, #8 + api_protocol check):
#   1. TARGET_URL is env-overridable and defaults to the IN-NETWORK service
#      (chatqna has no published host port and no Kong route by design — run
#      this script ON the deploy box, e.g. from a swarm-manager shell).
#   2. QUESTIONS localized to our corpus (lesothodocs/maize-services/*.md).
#   3. context payload = {"serviceLabels": []} — the post-DEC-27 product shape;
#      upstream's 'categoryLabel': 'General' predates the RequestContext model
#      (categoryLabels/serviceLabels) and is ignored dead weight.
#   4. DEFAULT_CONFIGS/TARGET_TEST_CONFIGS use 'top_n' — our
#      ChatCompletionRequest field; upstream's 'reranker_top_n' is not in the
#      model and would be silently dropped (readiness ping would not match the
#      swept configs). The generated grid already used 'top_n'.
#   5. RESULTS_FILE is env-overridable; default is TIMESTAMPED so a re-run
#      never appends into a previous run's CSV (upstream reused one constant
#      name — the append-only save_result mixes runs).
#   6. SMOKE_TEST_MODE / TARGET_SMOKE_TEST / SAMPLE_SIZE read from env
#      (upstream hardcodes constants — a `SMOKE_TEST_MODE=1 python3 ...`
#      invocation was a silent no-op that launched the full 810-config grid).
#   7. Readiness ping timeout 5 s → 60 s: inference alone routinely exceeds
#      5 s on this stack, so the poll could exhaust its 180 s budget against
#      a healthy service and abort queued pings server-side.
# WHERE TO RUN: TARGET_URL defaults to the in-network service name — a HOST
# shell cannot resolve swarm overlay DNS. Run from inside the network (e.g.
# `docker exec -it <any genieai_network container> bash` with this repo
# mounted/copied) or set TARGET_URL to a published port.
# Deps (undocumented upstream): aiohttp, pandas.
import os
import aiohttp
import asyncio
import time
import pandas as pd
import itertools
from pathlib import Path
import random
from datetime import datetime

# --- Short Test for Testing Logic Validation (env-driven; see header #6) ---
def _env_flag(name):
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}

SMOKE_TEST_MODE = _env_flag("SMOKE_TEST_MODE")
SAMPLE_SIZE = int(os.getenv("SAMPLE_SIZE", "1"))
TARGET_SMOKE_TEST = _env_flag("TARGET_SMOKE_TEST")

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
        'top_n': 5,
        'reranking_threshold': 0.0
    }
]

# chatqna is anonymous-in-network (no host port / Kong route): run on-box.
TARGET_URL = os.getenv("TARGET_URL", "http://chatqna-xeon-backend-server:8888/v1/chatqna")
RESULTS_FILE = os.getenv(
    "RESULTS_FILE",
    f"genieai_rag_config_test_results_async_run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
)

DEFAULT_CONFIGS = {
    'k': 10,
    'fetch_k': 20,
    'search_start': 'chunk',
    'enable_traversal': 'true',
    'traversal_max_depth': 1,
    'traversal_max_returned': 3,
    'traversal_score_threshold': 0.7,
    'reranking_strategy': 'threshold',
    'top_n': 2,
    'reranking_threshold': 0.75
}


def print_time_stamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# Lesotho maize corpus (lesothodocs/maize-services/): fact-dense,
# document-grounded, one per service doc — answers must be comparable across
# configs, so each question has specific verifiable facts behind it.
QUESTIONS = [
    "Which drought-tolerant maize cultivars are recommended for Lesotho, and what maturity periods do they have?",
    "How much seed should be used per acre for maize planting, and approximately how many days after sowing should seedlings be thinned when two seeds were planted per point?",
    "For maize stalk borer: when should scouting begin and end after emergence, what percentage of inspected plants with egg masses triggers treatment, and why does Alphathrin not work once larvae have tunneled into the stalk?",
    "Between what grain moisture levels can maize harvesting commence, and what moisture level is considered optimum for storage?",
    "What factors should pesticide selection for maize be based on, and what is the difference between pre-emergence and post-emergence products?",
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

            # 60 s, not 5: inference alone exceeds 5 s on this stack (header #7)
            async with session.post(url, json=payload, timeout=60) as response:

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
            "context": {'serviceLabels': []},
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
            print(f"\n[!] TARGETED SMOKE TEST ENABLED: {len(configurations)} config(s) x {len(QUESTIONS)} questions")

        else:
            configurations = random.sample(configurations, min(SAMPLE_SIZE, len(configurations)))
            print(f"\n[!] TEST MODE ENABLED: {len(configurations)} config(s) x {len(QUESTIONS)} questions")

    tasks = []

    for i, config in enumerate(configurations):
        for q_idx, question in enumerate(QUESTIONS):
            tasks.append((i + 1, config, q_idx + 1, question))

    asyncio.run(run_tests(tasks))

    print(f"\n[{print_time_stamp()}] End-to-End Testing Matrix Complete.\nGENIE.AI answers are ready for review.")


if __name__ == "__main__":
    main()
