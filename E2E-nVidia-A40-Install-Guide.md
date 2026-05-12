

# **Guide: NVIDIA Driver Installation on Ubuntu 22.04**

This guide covers the process of installing the server-grade NVIDIA drivers on E2E and resolving DKMS build failures caused by manually installed kernel headers. It outlines the specific steps needed to install NVIDIA drivers for an **NVIDIA A40 GPU** on **Ubuntu 22.04**, including how to bypass the common "Exit Status 10" error caused by rogue kernel headers. This is provided to help challenge participants install and configure on the specific images provided for the challenge on E2E Neetworks with A40 GPU

## **1\. Initial System Preparation**

Ensure your package repository is up to date and install the utility required to identify the correct drivers.

Bash
```
sudo apt update && sudo apt upgrade \-y  
sudo apt install ubuntu-drivers-common
```
## **2\. Identify the Hardware**

Run the following to confirm the system sees the A40 and to view available driver versions:

Bash
```
sudo ubuntu-drivers devices
```
**Expected Output (Truncated):**

vendor : NVIDIA Corporation

model : GA102GL \[**A40**\]

driver : **nvidia-driver-535-server** \- distro non-free

## **3\. Install the Driver**

For the A40 in a server environment, the **535-server** branch is highly recommended for stability and long-term support.

Note that you can upgrade to CUDA 12.8 later by installing the nvidia-driver-590 driver

Bash
```
sudo apt install nvidia-driver-535-server
```
## **4\. Conflict Resolution (The "Ghost Kernel" Fix)**

If the installation fails during the DKMS build phase, it is likely due to rogue **6.0 series** kernel modules/headers that are not fully installed but are confusing the builder.

### **A. Verify your active kernel**

Confirm you are running the stable **5.15** series:

Bash
```
uname \-r 
``` 
\# Output: 5.15.0-94-generic

### **B. Locate and Remove any/all 6.0 Leftovers**

Search for the offending files that are blocking the driver build:

Bash
```
ls /lib/modules | grep 6.0  
ls /usr/src | grep 6.0
```

If found, remove them manually:

Bash
```
sudo rm \-rf /lib/modules/6.0.0-060000-generic  
sudo rm \-rf /usr/src/linux-headers-6.0.0-060000-generic
```

### **C. Repair the Installation - this is key**

With the obstacles removed, tell apt and dpkg to finish the configuration:

Bash
```
sudo apt \--fix-broken install  
sudo dpkg \--configure \-a
```

## **5\. Verification**

Monitor the GPU status to ensure the driver is active and **CUDA 12.2** is correctly reported.

Bash

```
watch nvidia-smi
```

**Successful Output Check:**

* **GPU Name:** NVIDIA A40  
* **Driver Version:** 535.288.01  
* **CUDA Version:** 12.2  
* **Memory:** \~46GB visible

## **6\. Install NodeJS and NPM - required for Genie.AI**

```
apt update 
apt install nodejs npm
``` 
__Note:_ while 'nodejs' is usually the correct package name for Node.js, some systems might use 'node', in which case you should run_ ```apt install node```

**Check the versions!** Unfortunately the commands install ancient node and npm, so updates are needed - feel free to install node and npm 20 by other means if you are comfortable with the process.

```
npm -v
```

\#Output: 8.5.1

```
nodejs -v
```

\#Output: v12.22.9

## **7\. Update Node using Node Version Manager (NVM) or another means if you see fit**

### Run the install script
```curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash```
_(This installs nvm, which is a tool that lets you Install multiple Node.js versions)_<br><br>

### Configure your shell to use NVM
You need to tell your shell to load NVM automatically in every terminal session. Append the following lines to your ~/.bashrc by running this command
```
cat << 'EOF' >> ~/.bashrc
```
Then add these lines to the .bashrc file:

```
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
EOF
```

**Importantly,** this only writes the configuration. It does not activate NVM in your current session yet. You need to source ~/.bashrc each time you start a new session so if the nvm environment is not in bashrc then export it and source the .bashrc

### Activate NVM immediately
```
source ~/.bashrc
```
### Verify NVM is working
```
nvm --version
```
\#Output: 0.39.7

### Upgrade Node and npm versions and verify

bash
```
nvm install 20
nvm use 20
```
bash
```
node -v
npm -v
```
\#Output: v20.20.1<br>
\#Output: 10.8.2

## **8\. Update docker and install the docker compose plugin (this is needed for running Docker Swarm deployment)**

### Prepare for docker installs
```
sudo apt update

sudo apt-get install ca-certificates curl gnupg
```

### Create a keyring directory
```
sudo install -m 0755 -d /etc/apt/keyrings
```
**Note:** This creates the directory where Docker’s GPG key will be stored. 

### Download and add Docker GPG key:
bash

```
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
```
**Note:** This downloads Docker’s signing key and converts it to a format Ubuntu can use.
```
sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

**Note:** This changes permissions so the system can read the key.

### Add the Docker repository:
```
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \ 
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```
### Update package index and install docker compose plugin

```
sudo apt-get update

sudo apt-get install docker-compose-plugin
```

After completing these steps you should be able to run commands like
```docker service ls```, ```docker service logs```, etc.

## **9\. Use the env template for .env**
**NOTE:** You do have the choice to build your own .env but this will likely take a lot of time and experimentation - in the future we will add a configuration builder but for now just copy the template. If you want to be more studious then read the configuration guide in detail. It is likely time well invested now anyway

```
cp env .env
```

### Modify the file to replace the genie-ai.itu.int addresses with your IP address or host name

Example: ```VUE_APP_CSP_CONNECT_SRC=...``` 


### Replace the multi-line system prompts with single line prompts in the .env 
**NOTE:** Feel free to use your own system prompts - we have provided solid examples in the sample config.

``` LABEL_SELECTOR_SYSTEM_PROMPT="You are a precise semantic labeler for a Retrieval-Augmented Generation (RAG) system.\nYour goal: Assign the 1 to 3 MOST RELEVANT labels from the provided list that best describe the core topic(s) of the text chunk.\nRules:\n- Return ONLY labels that are strongly and directly semantically relevant to the specific chunk.\n- Most chunks should have 1–3 labels. Never exceed 4.\n- Do NOT try to \"maximize\" coverage or use as many labels as possible.\nWe only want the most semantically relevant labels\n- Prefer broader, higher-level labels when appropriate (e.g., \"Wildlife\" over \"Lion\", \"Weather\" over \"Rain\").\n- Do NOT suggest new labels unless the concept is completely absent and critically important.\n- If 2 or more of the provided labels are selected then DO NOT suggest new labels\n- If no label fits well, return a minimal list of suggested labels that are are strongly and directly semantically relevant to the specific chunk.\n- NEVER include labels just because they appear elsewhere in the document.\nExisting labels (use ONLY these are allowed):\n{labels_list}\n\nOutput format (strict JSON, no extra text):\n{\"labels\": [\"Label1\", \"Label2\"]}" ```

``` CHATQNA_SYSTEM_PROMPT="<INSTRUCTIONS>\nYou are a friendly and polite information assistant.\nYour task is to answer the user's latest question using only the content provided from the knowledge base.\nDo not invent or assume information; if the answer is not in the provided content, inform the user that the information is unavailable.\nUse the user's name, gender, age, preferences, and chat history to tailor and personalise your responses.\nKeep answers informative but concise; provide detailed explanations only when necessary or explicitly requested.\n</INSTRUCTIONS>\n\nIn line with the above instructions, generate a reply to the user's latest message in the chat history based on the relevant content provided." ```

### Go to Huggingface and create your own access token and replace in .env.
```HUGGING_FACE_HUB_TOKEN=<your huggingface token>```

**Note:** The VLLM_API_KEY can be removed unless you are using external services (which you are not)**
```VLLM_API_KEY=<your vLLM API key>```


## **10\. Initialize Docker Swarm and deploy the stack**
```
docker swarm init
set -a && source .env && set +a
docker stack deploy -c docker-compose.yaml genieai
```

## **11\. Check the status of the services**
```
docker service ls

docker service logs genieai_backend -f
```

**NOTE:** that at this point there will be errors in the logs and containers restarting - this is because the configuration is incomplete

## **12\. Proceed to "Step 4: Infrastructure Configuration" in the GENIE.AI-Installation-Configuration-Guide.md 

[GENIE.AI Installation and Configuration Guide](https://opensource.unicc.org/un/itu/genie-ai/-/blob/main/GENIE.AI-Installation-Configuration-Guide.md?ref_type=heads)

