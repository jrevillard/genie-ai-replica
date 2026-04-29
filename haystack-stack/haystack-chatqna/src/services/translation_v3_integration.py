"""
Translation v3 Integration — monkey-patches the agent_routes.py
translation path to use phrase-bank-first bilingual responses
instead of raw LLM translation.

Replaces the simple `translator.translate(english, "en", "ma")` call
with the v3 pipeline:
  1. Build bilingual response (phrase bank greeting + key phrases + summary)
  2. Run translation quality gate on any LLM-translated segments
  3. Decide: SERVE_MANDINKA / SERVE_BILINGUAL / SERVE_ENGLISH_ONLY
  4. For diet plans: route through build_diet_plan_bilingual

All existing greeting.py / translator.py code continues to work as
before — this only changes the response body translation, not the
greeting layer.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _install_patch():
    """Wrap the agent_routes chat handler to intercept Mandinka translation."""

    try:
        from src.api import agent_routes
    except ImportError:
        logger.warning("translation_v3_integration: agent_routes not importable")
        return

    _original_chat = getattr(agent_routes, "agent_chat", None)
    if not _original_chat or getattr(_original_chat, "_v3_translation_patched", False):
        return

    async def _patched_chat(request, http_request=None):
        """Intercept the response and apply v3 translation when language=ma."""
        # Let the original handler run (it may or may not translate)
        result = await _original_chat(request, http_request)

        # Only intervene if user requested Mandinka
        if getattr(request, "language", "en") != "ma":
            return result

        try:
            from src.services.bilingual_response import get_builder
            from src.services.translation_gate import get_gate

            builder = get_builder()
            gate = get_gate()

            english_text = getattr(result, "english_original", None) or result.response
            intent = getattr(result, "intention", "") or ""
            tools_used = getattr(result, "tools_used", []) or []

            # Detect if this is a diet/meal plan response
            is_diet_plan = any(
                t in ("generate_care_plan", "get_diet_advice", "diet", "meal_plan")
                for t in tools_used
            ) or _looks_like_meal_plan(english_text)

            if is_diet_plan:
                conditions = _extract_conditions(english_text)
                diet_result = builder.build_diet_plan_bilingual(
                    english_text, conditions,
                )
                result.response = _run_corrector(diet_result["annotated_plan"], english_text, request)
                result.english_original = english_text
                return result

            bilingual = builder.build_response(
                english_response=english_text,
                intent=intent,
            )

            # If there was LLM translation, run the quality gate on it
            llm_translated = result.response
            if llm_translated != english_text:
                gate_result = gate.verify_translation(english_text, llm_translated)
                decision = gate_result["decision"]

                if decision == "SERVE_MANDINKA":
                    mandinka_body = _run_corrector(llm_translated, english_text, request)
                    result.response = (
                        f"{bilingual['mandinka_greeting']} "
                        f"{mandinka_body}\n\n"
                        f"{bilingual['mandinka_closing']}"
                    )

                elif decision == "SERVE_BILINGUAL":
                    # Partial quality — show English with Mandinka key phrases
                    key_phrase_lines = "\n".join(
                        f"  {p['english']}: {p['mandinka']}"
                        for p in bilingual["mandinka_key_phrases"][:6]
                    )
                    result.response = (
                        f"{bilingual['mandinka_greeting']}\n\n"
                        f"{english_text}\n\n"
                        f"--- Mandinka ---\n"
                        f"{bilingual['mandinka_summary']}\n\n"
                        f"{key_phrase_lines}\n\n"
                        f"{bilingual['mandinka_closing']}"
                    )
                    result.english_original = english_text

                else:  # SERVE_ENGLISH_ONLY
                    # Translation too unreliable — English with Mandinka bookends
                    result.response = (
                        f"{bilingual['mandinka_greeting']}\n\n"
                        f"{english_text}\n\n"
                        f"{bilingual['mandinka_closing']}"
                    )
                    result.english_original = english_text
            else:
                # No translation was done (language=ma but translator failed?)
                # Apply bilingual format
                key_phrase_lines = "\n".join(
                    f"  {p['english']}: {p['mandinka']}"
                    for p in bilingual["mandinka_key_phrases"][:6]
                )
                summary = bilingual["mandinka_summary"]
                result.response = (
                    f"{bilingual['mandinka_greeting']}\n\n"
                    f"{english_text}\n\n"
                    + (f"--- Mandinka ---\n{summary}\n\n" if summary else "")
                    + (f"{key_phrase_lines}\n\n" if key_phrase_lines.strip() else "")
                    + f"{bilingual['mandinka_closing']}"
                )
                result.english_original = english_text
                result.detected_language = "ma"

        except Exception as exc:
            logger.warning("v3 translation integration failed (non-fatal): %s", exc)

        return result

    _patched_chat._v3_translation_patched = True

    # The FastAPI route handler is the endpoint function, not the wrapper.
    # We need to replace the route handler in the router.
    try:
        for route in agent_routes.router.routes:
            # Router prefix is "/agent", so route.path is the prefixed form.
            if hasattr(route, "path") and route.path == "/agent/chat":
                if hasattr(route, "endpoint"):
                    _original_endpoint = route.endpoint

                    async def _wrapped_endpoint(
                        request, http_request=None,
                        _orig=_original_endpoint,
                    ):
                        result = await _orig(request, http_request)

                        if getattr(request, "language", "en") != "ma":
                            return result

                        try:
                            return await _apply_v3_translation(result, request)
                        except Exception as exc:
                            logger.warning("v3 patch on /chat endpoint failed: %s", exc)
                            return result

                    route.endpoint = _wrapped_endpoint
                    route.dependant = None  # Force FastAPI to re-analyze
                    logger.info("translation_v3_integration: /chat endpoint patched")
                    break
    except Exception as exc:
        logger.warning("translation_v3_integration: route patching failed: %s", exc)


async def _apply_v3_translation(result, request):
    """Apply v3 bilingual translation to a chat response."""
    from src.services.bilingual_response import get_builder
    from src.services.translation_gate import get_gate

    builder = get_builder()
    gate = get_gate()

    english_text = getattr(result, "english_original", None) or result.response
    intent = getattr(result, "intention", "") or ""
    tools_used = getattr(result, "tools_used", []) or []

    is_diet_plan = any(
        t in ("generate_care_plan", "get_diet_advice", "diet", "meal_plan")
        for t in tools_used
    ) or _looks_like_meal_plan(english_text)

    if is_diet_plan:
        conditions = _extract_conditions(english_text)
        diet_result = builder.build_diet_plan_bilingual(english_text, conditions)
        result.response = _run_corrector(diet_result["annotated_plan"], english_text, request)
        result.english_original = english_text
        return result

    bilingual = builder.build_response(
        english_response=english_text,
        intent=intent,
    )

    llm_translated = result.response
    if llm_translated != english_text:
        gate_result = gate.verify_translation(english_text, llm_translated)
        decision = gate_result["decision"]

        if decision == "SERVE_MANDINKA":
            mandinka_body = _run_corrector(llm_translated, english_text, request)
            result.response = (
                f"{bilingual['mandinka_greeting']} "
                f"{mandinka_body}\n\n"
                f"{bilingual['mandinka_closing']}"
            )
        elif decision == "SERVE_BILINGUAL":
            kp = "\n".join(
                f"  {p['english']}: {p['mandinka']}"
                for p in bilingual["mandinka_key_phrases"][:6]
            )
            result.response = (
                f"{bilingual['mandinka_greeting']}\n\n"
                f"{english_text}\n\n"
                f"--- Mandinka ---\n"
                f"{bilingual['mandinka_summary']}\n\n"
                f"{kp}\n\n"
                f"{bilingual['mandinka_closing']}"
            )
            result.english_original = english_text
        else:
            result.response = (
                f"{bilingual['mandinka_greeting']}\n\n"
                f"{english_text}\n\n"
                f"{bilingual['mandinka_closing']}"
            )
            result.english_original = english_text
    else:
        kp = "\n".join(
            f"  {p['english']}: {p['mandinka']}"
            for p in bilingual["mandinka_key_phrases"][:6]
        )
        summary = bilingual["mandinka_summary"]
        result.response = (
            f"{bilingual['mandinka_greeting']}\n\n"
            f"{english_text}\n\n"
            + (f"--- Mandinka ---\n{summary}\n\n" if summary else "")
            + (f"{kp}\n\n" if kp.strip() else "")
            + f"{bilingual['mandinka_closing']}"
        )
        result.english_original = english_text
        result.detected_language = "ma"

    return result


def _run_corrector(mandinka_text: str, english_source: str, request) -> str:
    """Run TranslationCorrector v4.4 on Mandinka text. Returns corrected or English fallback."""
    try:
        from src.nlp.translation_corrector import get_corrector
        corrector = get_corrector()
        cr = corrector.correct(
            mandinka_text=mandinka_text,
            english_source=english_source,
            patient_context={
                "patient_name": getattr(request, "patient_name", "") or "",
                "user_role": getattr(request, "user_role", None),
            },
        )
        logger.info("TranslationCorrector v4.4: rec=%s score=%.2f corrections=%d",
                     cr["recommendation"], cr["overall_score"], len(cr["corrections_applied"]))
        if cr["recommendation"] == "BLOCK_USE_ENGLISH":
            return english_source
        return cr["corrected_text"]
    except Exception as exc:
        logger.warning("TranslationCorrector failed (non-fatal): %s", exc)
        return mandinka_text


def _looks_like_meal_plan(text: str) -> bool:
    """Heuristic: does this response look like a meal/diet plan?"""
    t = text.lower()
    day_count = sum(1 for d in ["monday", "tuesday", "wednesday", "thursday",
                                "friday", "saturday", "sunday"] if d in t)
    meal_count = sum(1 for m in ["breakfast", "lunch", "dinner", "snack"] if m in t)
    return day_count >= 3 or (day_count >= 2 and meal_count >= 2)


def _extract_conditions(text: str) -> list:
    """Extract patient conditions mentioned in the response."""
    t = text.lower()
    conditions = []
    if "diabet" in t or "blood sugar" in t or "glucose" in t:
        conditions.append("diabetes")
    if "hypertens" in t or "blood pressure" in t or "bp" in t:
        conditions.append("hypertension")
    if "heart" in t or "cardiac" in t or "cardiovascular" in t:
        conditions.append("heart_disease")
    return conditions


def install_on_app(app) -> bool:
    """
    Patch the v3 wrapper onto FastAPI's actual app routes.

    Required because `app.include_router(agent_routes.router)` creates a
    NEW APIRoute on `app.router.routes` rather than sharing the object
    on `agent_routes.router.routes`. So `_install_patch()` (called at
    module load) successfully patches the source router, but the route
    that actually serves traffic is unaffected.

    Strategy: locate the existing /api/v1/agent/chat APIRoute, copy its
    config (response_model, methods, dependencies, etc.), build a
    wrapped endpoint that delegates to the original via the captured
    `endpoint` attribute, then *replace the entry in app.router.routes*
    with a fresh APIRoute constructed from the wrapper. Constructing a
    fresh APIRoute is cleaner than mutating `route.app` / `route.dependant`
    in place, which we tried first and hit FastAPI internals.

    Idempotent (no-op if already patched). Never raises.
    """
    if app is None:
        return False
    try:
        from fastapi.routing import APIRoute
        import functools
        import inspect

        target_idx = None
        target_route = None
        for i, route in enumerate(app.router.routes):
            if isinstance(route, APIRoute) and getattr(route, "path", "") == "/api/v1/agent/chat":
                target_idx = i
                target_route = route
                break
        if target_route is None:
            logger.warning(
                "translation_v3_integration: /api/v1/agent/chat APIRoute not found in app.router.routes",
            )
            return False
        if getattr(target_route.endpoint, "_v3_app_route_patched", False):
            logger.info("translation_v3_integration: app /api/v1/agent/chat already patched")
            return True

        _original_endpoint = target_route.endpoint

        @functools.wraps(_original_endpoint)
        async def _wrapped_endpoint(*args, _orig=_original_endpoint, **kwargs):
            result = await _orig(*args, **kwargs)
            request = kwargs.get("request") or (args[0] if args else None)
            if not request or getattr(request, "language", "en") != "ma":
                return result
            try:
                return await _apply_v3_translation(result, request)
            except Exception as exc:
                logger.warning(
                    "v3 patch on /api/v1/agent/chat failed: %s", exc,
                )
                return result

        _wrapped_endpoint.__signature__ = inspect.signature(_original_endpoint)
        _wrapped_endpoint._v3_app_route_patched = True

        # Build a fresh APIRoute mirroring the original's config but
        # pointing at the wrapped endpoint. APIRoute.__init__ rebuilds
        # dependant + body_field + app correctly — no manual surgery
        # required, and FastAPI's middleware stack continues to work.
        new_route = APIRoute(
            path=target_route.path,
            endpoint=_wrapped_endpoint,
            response_model=target_route.response_model,
            status_code=target_route.status_code,
            tags=target_route.tags,
            dependencies=target_route.dependencies,
            summary=target_route.summary,
            description=target_route.description,
            response_description=target_route.response_description,
            responses=target_route.responses,
            deprecated=target_route.deprecated,
            name=target_route.name,
            methods=target_route.methods,
            operation_id=target_route.operation_id,
            response_model_include=target_route.response_model_include,
            response_model_exclude=target_route.response_model_exclude,
            response_model_by_alias=target_route.response_model_by_alias,
            response_model_exclude_unset=target_route.response_model_exclude_unset,
            response_model_exclude_defaults=target_route.response_model_exclude_defaults,
            response_model_exclude_none=target_route.response_model_exclude_none,
            include_in_schema=target_route.include_in_schema,
            response_class=target_route.response_class,
            callbacks=target_route.callbacks,
            openapi_extra=target_route.openapi_extra,
            generate_unique_id_function=target_route.generate_unique_id_function,
        )

        app.router.routes[target_idx] = new_route
        logger.info(
            "translation_v3_integration: app /api/v1/agent/chat APIRoute replaced (v3 wrapper active)",
        )
        return True
    except Exception as exc:
        logger.warning("translation_v3_integration: install_on_app failed: %s", exc)
        return False


try:
    _install_patch()
except Exception as exc:
    logger.warning("translation_v3_integration: install failed: %s", exc)
