

## **Guide: NVIDIA Driver Installation on Ubuntu 22.04 (Conflict Resolution)**

This guide covers the process of installing the server-grade NVIDIA drivers on E2E and resolving DKMS build failures caused by manually installed kernel headers. It outlines the specific steps needed to install NVIDIA drivers for an **NVIDIA A40 GPU** on **Ubuntu 22.04**, including how to bypass the common "Exit Status 10" error caused by rogue kernel headers.

## ---

**1\. Initial System Preparation**

Ensure your package repository is up to date and install the utility required to identify the correct drivers.

Bash

sudo apt update && sudo apt upgrade \-y  
sudo apt install ubuntu-drivers-common

## **2\. Identify the Hardware**

Run the following to confirm the system sees the A40 and to view available driver versions:

Bash

sudo ubuntu-drivers devices

**Expected Output (Truncated):**

vendor : NVIDIA Corporation

model : GA102GL \[**A40**\]

driver : **nvidia-driver-535-server** \- distro non-free

## **3\. Install the Driver**

For the A40 in a server environment, the **535-server** branch is highly recommended for stability and long-term support.

Bash

sudo apt install nvidia-driver-535-server

## ---

**4\. Conflict Resolution (The "Ghost Kernel" Fix)**

If the installation fails during the DKMS build phase, it is likely due to rogue **6.0 series** kernel modules/headers that are not fully installed but are confusing the builder.

### **A. Verify your active kernel**

Confirm you are running the stable **5.15** series:

Bash

uname \-r  
\# Output: 5.15.0-94-generic

### **B. Locate and Remove 6.0 Leftovers**

Search for the offending files that are blocking the driver build:

Bash

ls /lib/modules | grep 6.0  
ls /usr/src | grep 6.0

If found, remove them manually:

Bash

sudo rm \-rf /lib/modules/6.0.0-060000-generic  
sudo rm \-rf /usr/src/linux-headers-6.0.0-060000-generic

### **C. Repair the Installation**

With the obstacles removed, tell apt and dpkg to finish the configuration:

Bash

sudo apt \--fix-broken install  
sudo dpkg \--configure \-a

## ---

**5\. Verification**

Monitor the GPU status to ensure the driver is active and **CUDA 12.2** is correctly reported.

Bash

watch nvidia-smi

**Successful Output Check:**

* **GPU Name:** NVIDIA A40  
* **Driver Version:** 535.288.01  
* **CUDA Version:** 12.2  
* **Memory:** \~46GB visible

