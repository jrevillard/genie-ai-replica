# OPEA TRANSLATION MICROSERVICE

import os
import time
from typing import Union

from comps import (
    CustomLogger,
    TranslationRequest,
    TranslationResponse,
    OpeaComponentLoader,
    ServiceType,
    opea_microservices,
    register_microservice,
    register_statistics,
    statistics_dict,
)
from comps.cores.telemetry.opea_telemetry import opea_telemetry

logger = CustomLogger("translation")
logflag = os.getenv("LOGFLAG", False)

translation_component_name = os.getenv("TRANSLATION_COMPONENT_NAME", "OpeaTranslationService")
if logflag:
    logger.info(f"Get translation_component_name {translation_component_name}")

if translation_component_name == "OpeaTranslationService":
    from integrations.translation_service import OpeaTranslationService
else:
    raise ValueError(f"Unknown TRANSLATION_COMPONENT_NAME: {translation_component_name}")

# Initialize OpeaComponentLoader
loader = OpeaComponentLoader(translation_component_name, description=f"OPEA Translation Component: {translation_component_name}")


@register_microservice(
    name="opea_service@translation",
    service_type=ServiceType.TRANSLATION,
    endpoint="/v1/translate",
    host="0.0.0.0",
    port=9100,
)
@opea_telemetry
@register_statistics(names=["opea_service@translation"])
async def translate(input: TranslationRequest) -> TranslationResponse:
    start = time.time()

    if logflag:
        logger.info(f"Translation input: {input}")

    try:
        response = await loader.invoke(input)
        statistics_dict["opea_service@translation"].append_latency(time.time() - start, None)
        return response

    except Exception as e:
        logger.error(f"Error during translation: {e}")
        raise


if __name__ == "__main__":
    logger.info("OPEA Translation Microservice is starting...")
    opea_microservices["opea_service@translation"].start()
