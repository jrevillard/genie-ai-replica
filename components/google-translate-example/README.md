# OPEA Google Translate Microservice

This microservice is an **OPEA-compatible translation service** that leverages **Google Translate API** to pre-process user input prompts and translate them before retrieval. It also translates responses back to the user's language.

---

## **🚀 Features**
- ✅ Translates user input from **any language to English** for processing.
- ✅ Translates responses **back to the original language**.
- ✅ Uses **Google Cloud Translation API** for fast and accurate translations.
- ✅ Built with **FastAPI**, deployable in **Docker** or locally.

---

## **📌 Prerequisites**
1. **Python 3.10 or later**  
2. **Google Cloud Project with Cloud Translation API enabled**  
3. **A service account JSON key for Google Translate API**  
4. **Required Python packages** (`fastapi`, `uvicorn`, `google-cloud-translate`, `requests`)

---

## **🛠️ Setup Instructions**
### **1️⃣ Clone This Repository**
```bash
git clone https://github.com/your-repo/opea-google-translate-microservice.git
cd opea-google-translate-microservice
```

### **2️⃣ Install Required Python Packages**
```bash
pip install fastapi uvicorn google-cloud-translate requests
```

---

## **🌍 Setting Up Google Cloud Service Account**
To use the Google Translate API, you need to create a **Google Cloud service account** and get a JSON key.

### **1️⃣ Enable Cloud Translation API**
1. Go to **Google Cloud Console**:  
   👉 [Enable Cloud Translation API](https://console.developers.google.com/apis/api/translate.googleapis.com/overview)
2. Click **"Enable"**.
3. Wait **a few minutes** for the API to activate.

---

### **2️⃣ Create a Service Account**
1. Open **Google Cloud Console** → [IAM & Admin](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click **"Create Service Account"**.
3. Enter a **name** (e.g., `translate-service-account`).
4. Click **"Create and Continue"**.
5. Assign the role: **"Cloud Translation API User"**.
6. Click **"Done"**.

---

### **3️⃣ Generate JSON Key for the Service Account**
1. In the **Service Accounts** page, find your newly created account.
2. Click on the **service account name**.
3. Go to the **"Keys"** tab.
4. Click **"Add Key"** → **"Create new key"**.
5. Select **"JSON"** and click **"Create"**.
6. **Download the `.json` file** (this is your API key).

---

## **🔧 Set Up Environment Variables**
You must set the environment variable **so Python can find your service account JSON file**.

### **1️⃣ Move the JSON File to a Secure Location**
For example, move it to:
```
D:\Model-Training\sources\translate-api-project-450909.json
```

---

### **2️⃣ Set Environment Variable**
Depending on your operating system, set the environment variable:

#### **For macOS/Linux:**
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your-service-account.json"
```

#### **For Windows (Command Prompt):**
```cmd
set GOOGLE_APPLICATION_CREDENTIALS=D:\Model-Training\sources\translate-api-project-450909.json
```

#### **For Windows (PowerShell):**
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="D:\Model-Training\sources\translate-api-project-450909.json"
```

---

### **3️⃣ Verify Google Cloud Authentication**
Run this quick **Python script** to ensure everything is set up correctly:
```python
import os
from google.cloud import translate_v2 as translate

json_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
if json_path:
    print(f"✅ Service account JSON path found: {json_path}")
    client = translate.Client()
    print("✅ Google Translate API is working!")
else:
    print("❌ Environment variable not set. Set GOOGLE_APPLICATION_CREDENTIALS.")
```

If you see:
```
✅ Service account JSON path found: D:\Model-Training\sources\translate-api-project-450909.json
✅ Google Translate API is working!
```
Then you're all set! 🚀

---

## **🔧 Modify OPEA Configuration (`compose.yaml`)**
To integrate this service into OPEA, modify the `compose.yaml` file:

### **1️⃣ Add Translation Service**
```yaml
services:
  translation_service:
    image: your-translation-service-image
    container_name: translation_service
    ports:
      - "8001:8001"
    environment:
      - GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-service-account.json
    volumes:
      - /local/path/to/your-service-account.json:/path/to/your-service-account.json
    networks:
      - opea_network
```

### **2️⃣ Modify Input, Output, and Vectorization Services**
```yaml
services:
  user_input_processor:
    image: your-user-input-processor-image
    environment:
      - TRANSLATION_SERVICE_URL=http://translation_service:8001/translate
    depends_on:
      - translation_service

  model_output_processor:
    image: your-model-output-processor-image
    environment:
      - TRANSLATION_SERVICE_URL=http://translation_service:8001/translate
    depends_on:
      - translation_service
```

### **3️⃣ Configure Vectorization**
```yaml
services:
  vectorizer_service:
    image: your-vectorizer-service-image
    environment:
      - VECTOR_STORE_PATH=/path/to/vector/store
    volumes:
      - /local/path/to/vector/store:/path/to/vector/store
    networks:
      - opea_network
```

---

## **🚀 Next Steps**
✅ Test the API with different languages.  
✅ Deploy the service on a **cloud server or Kubernetes**.  
✅ Optimize caching for **frequent translations**.  

**Enjoy using the OPEA Google Translate Microservice! 🚀**

