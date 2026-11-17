# XR-7 Controller Reference

This file exists for the e2e suite's real-citation spec
(`tests/e2e/chatbot/real-rag-citation.spec.js`): the spec ingests it through
the repository's own upload route, waits for the dataprep status to reach
`Ingested`, then asks the chatbot a question whose answer lives here and
asserts that the answer carries the fact and that the sources cite this file.
It is deleted again by the spec's cleanup sweep.

## Maintenance access code

The maintenance access code for the XR-7 controller is QZK-7319.

Keep this code confidential: it opens the controller's service hatch and must
only be shared with certified maintenance personnel.

## Variants

The XR-7 controller ships in two variants: the XR-7B for indoor housings and
the XR-7S for submersible housings. Both variants share the same maintenance
access code.
