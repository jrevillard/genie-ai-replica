# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0


import os

from comps import CustomLogger
from opea_dataprep_loader import OpeaDataprepLoader

logger = CustomLogger("genie_dataprep_loader")
logflag = os.getenv("LOGFLAG", False)


class GenieDataprepLoader(OpeaDataprepLoader):
    """
    A custom GENIE.AI loader extending OPEA dataprep loader.
    Forwards Genie-specific methods to the GenieArangoDataprep component.
    """
    async def ingest_file_with_guardrail(self, *args, **kwargs):
        file_id = None
        if args and hasattr(args[0], "file_id"):
            file_id = args[0].file_id
        logger.info(f"[TRACE_TMP][dataprep-loader] ingest_file_with_guardrail:start fileId={file_id}")
        if logflag:
            logger.info("[ dataprep loader ] ingest file with guardrail")
        # Forward arguments (including lock_file) to the component
        result = await self.component.ingest_file_with_guardrail(*args, **kwargs)
        logger.info(f"[TRACE_TMP][dataprep-loader] ingest_file_with_guardrail:done fileId={file_id}")
        return result
    
    async def retract_file(self, *args, **kwargs):
        if logflag:
            logger.info("[ dataprep loader ] retract files")
        return await self.component.retract_file(*args, **kwargs)