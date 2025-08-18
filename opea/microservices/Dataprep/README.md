Dataprep microservice
=====================

This repository contains code derived from the [OPEA Dataprep Microservice](https://github.com/opea-project/GenAIComps/tree/main/comps/dataprep) (see [opea-project](https://github.com/opea-project) on GitHub for more details). The microservice aims to preprocess the data from various sources (either structured or unstructured data) to text data, and ingest that data into a searchable database.

Several modifications have been introduced to adapt the original OPEA microservice to the needs and requirements of the ITU Initiative on Open-Source GenAI for Public Services, specifically for the [Multilingual Chatbot for Public Services Discovery use case](https://osaips.atlassian.net/wiki/external/Y2QzYmIyODljZmMzNDBhOGI2NzA5MzBkODUyZDk1NmU):

*   The [utils.py](https://github.com/opea-project/GenAIComps/blob/main/comps/dataprep/src/utils.py) file in dataprep/src has been modified to:
	*	adapt the workflow for extracting text from PDF files, including by adding a workflow to remove content from headers and footers and by replacing pytesseract with easyocr for processing images in PDFs;
	*	adapt the workflow for extracting text from html by complementing the UnstructuredHTMLLoader with structured extraction using Beautiful Soup. 
    
*   Integrations with database solutions that are not fully open-source (i.e. licensed under Apache 2.0 or MIT) have been removed. 