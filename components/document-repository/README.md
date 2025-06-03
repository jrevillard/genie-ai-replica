# File System Backend

This service provides a backend file system for managing file CRUD operations. It is designed to connect with the frontend located at `/root/chat-ui-vue-app/gov-chat-frontend`.

## Supported File Types
The file system supports various file types, including but not limited to:
- Text files (`.txt`)
- Document files (`.pdf`, `.docx`)
- Web files (`.html`)
- Sheet files (`.xlsx`)

## Feature Services

- **Upload Files:** Administrators can upload files from their local computers.
- **Read Files:** Uploaded files are stored in `/root/chat-ui-file-system/uploads` and can be accessed for viewing in browser for all file types.
- **Download Files:** Files can be downloaded to the administrator's local machine.
- **Delete Files:** Administrators can remove files from the system.


## Folder Structure

```
/root/chat-ui-file-system/
├── README.md
├── fileRoutes.js
├── fileService.js
├── index.js
├── package-lock.json
├── package.json
├── uploads
├── node_modules
    ├── express
    ├── multer
    ├── cors
    ├── morgan
    └── ...
└── .gitignore
```


## Setup

To set up the file system backend service:

1. **Navigate to the project directory:**
    ```bash
    cd chat-ui-file-system
    ```

2. **Initialize the project:**
    ```bash
    npm init -y
    ```

3. **Install required dependencies:**
    ```bash
    npm install express multer cors morgan
    ```

4. **Run the service (in the background):**
    ```bash
    node index.js &
    ```

## Usage (for testing)

To test file CRUD operations, use the following `curl` commands:

### Upload a File

Upload from the backend server:
```bash
curl -X POST http://localhost:9981/api/files/upload \
    -F "file=@/root/AAA-testing.txt"
```

Upload from your local computer to the remote file system:
```bash
curl -X POST http://<remote-node-ip>:9981/api/files/upload \
    -F "file=@/path/to/local/file.pdf"
```

---

### Read/View a File

Read a file from the backend server:
```bash
curl http://localhost:9981/api/files/read/1748524213244-962969549-AAA-testing.txt
```
Or simply open the URL in your browser to view the file.

---

### Download a File

Download from the backend server:
```bash
curl http://localhost:9981/api/files/1748521446956-129192260-AAA-testing.txt --output downloaded.txt
```

Download from the remote file system to your local computer:
```bash
curl http://<remote-node-ip>:9981/api/files/1748524213244-962969549-ExamplePDF.pdf --output /path/to/local/destination/<filename>
```

---

### Delete a File

Delete from the backend server:
```bash
curl -X DELETE http://localhost:9981/api/files/1748521446956-129192260-AAA-testing.txt
```

Delete from your local computer (remotely):
```bash
curl -X DELETE http://<remote-node-ip>:9981/api/files/1748524213244-962969549-ExamplePDF.pdf
```

## Security

- Common users authenticated as citizens can only read files.
- Users authenticated as administrators can access all the file operations.
- File access is not restricted to intranet or localhost; remote access is supported.

## License 🫐

See [LICENSE](./LICENSE) for details.