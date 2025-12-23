import 'package:flutter/material.dart';

// Define the primary color from your Vue3 theme
const Color kPrimaryColor = Color(0xFF4A7EBB);

void main() {
  runApp(const GenieAIApp());
}

class GenieAIApp extends StatelessWidget {
  const GenieAIApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Genie.AI Mobile',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: kPrimaryColor, primary: kPrimaryColor),
        useMaterial3: true,
        // Default styling for buttons to match theme
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: kPrimaryColor,
            foregroundColor: Colors.white,
            minimumSize: const Size(double.infinity, 50),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
        ),
        // Default styling for inputs
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.grey[100],
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide.none,
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        ),
      ),
      // Define navigation routes
      initialRoute: '/login',
      routes: {
        '/login': (context) => const LoginScreen(),
        '/register': (context) => const RegistrationScreen(),
        '/reset-password': (context) => const PasswordResetScreen(),
        '/home': (context) => const MainChatScreen(),
      },
    );
  }
}

// ================== LOGIN SCREEN (Mimics image_14.png) ==================
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _rememberMe = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
               // Placeholder for Logo
              const Icon(Icons.auto_awesome, size: 60, color: kPrimaryColor),
              const SizedBox(height: 16),
              const Text("GENIE.AI", style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.black87)),
              const SizedBox(height: 40),
              
              // Inputs
              _buildLabeledTextField("Username", "fordendk"),
              _buildLabeledTextField("Password", "••••••••", isPassword: true),
              
              // Remember Me & Forgot Password Row
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Checkbox(
                        value: _rememberMe,
                        activeColor: kPrimaryColor,
                        onChanged: (val) => setState(() => _rememberMe = val!),
                      ),
                      const Text("Remember me"),
                    ],
                  ),
                  TextButton(
                    onPressed: () => Navigator.pushNamed(context, '/reset-password'),
                    child: const Text("Forgot password?", style: TextStyle(color: kPrimaryColor)),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              
              // Login Button
              ElevatedButton(
                onPressed: () {
                  // SIMULATION: Navigate to Home Screen on click
                  Navigator.pushReplacementNamed(context, '/home');
                },
                child: const Text("Login", style: TextStyle(fontSize: 16)),
              ),
              
              const SizedBox(height: 24),
              // Register Link
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text("Don't have an account? "),
                  GestureDetector(
                    onTap: () => Navigator.pushNamed(context, '/register'),
                    child: const Text("Register now", style: TextStyle(color: kPrimaryColor, fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
               const SizedBox(height: 24),
               const Row(children: [Expanded(child: Divider()), Padding(padding: EdgeInsets.all(8.0), child: Text("or")), Expanded(child: Divider())]),
               const SizedBox(height: 24),
               // Social Buttons (UI placeholders)
               _buildSocialButton("Continue with Google", Icons.g_mobiledata, Colors.red),
               const SizedBox(height: 12),
               _buildSocialButton("Continue with Facebook", Icons.facebook, const Color(0xFF3B5998)),
            ],
          ),
        ),
      ),
    );
  }
}

// ================== REGISTRATION SCREEN (Mimics image_10.png) ==================
class RegistrationScreen extends StatefulWidget {
  const RegistrationScreen({super.key});

  @override
  State<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends State<RegistrationScreen> {
  bool _acceptTos = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
       backgroundColor: Colors.white,
      appBar: AppBar(backgroundColor: Colors.white, elevation: 0, iconTheme: const IconThemeData(color: Colors.black)),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text("Create New Account", style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.black87)),
              const SizedBox(height: 32),
              
              _buildLabeledTextField("Username", "fordendk"),
              _buildLabeledTextField("Email", "Enter your email"),
              _buildLabeledTextField("Password", "••••••••", isPassword: true),
              _buildLabeledTextField("Confirm Password", "Confirm your password", isPassword: true),
              
              // TOS Checkbox
              Row(
                children: [
                  Checkbox(
                    value: _acceptTos,
                    activeColor: kPrimaryColor,
                    onChanged: (val) => setState(() => _acceptTos = val!),
                  ),
                  const Text("I accept the ", style: TextStyle(color: Colors.black87)),
                  const Text("Terms of Service", style: TextStyle(color: kPrimaryColor, fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 24),
              
              ElevatedButton(
                onPressed: () { Navigator.pop(context); }, // Simulate creation and go back to login
                child: const Text("Create Account", style: TextStyle(fontSize: 16)),
              ),
              
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text("Already have an account? "),
                  GestureDetector(
                    onTap: () => Navigator.pop(context),
                    child: const Text("Log in", style: TextStyle(color: kPrimaryColor, fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ================== PASSWORD RESET SCREEN (Mimics image_12.png) ==================
class PasswordResetScreen extends StatelessWidget {
  const PasswordResetScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
       appBar: AppBar(backgroundColor: Colors.white, elevation: 0, iconTheme: const IconThemeData(color: Colors.black)),
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
             const Text("Reset Your Password", style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.black87)),
             const SizedBox(height: 32),
            const Text("Enter your email address and we'll send you a link to reset your password.", textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
            const SizedBox(height: 32),
            _buildLabeledTextField("Email Address", "Enter your email"),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Reset link sent!")));
                Navigator.pop(context);
              },
              child: const Text("Send Reset Link", style: TextStyle(fontSize: 16)),
            ),
             const SizedBox(height: 24),
              GestureDetector(
                onTap: () => Navigator.pop(context),
                child: const Text("Back to Login", style: TextStyle(color: kPrimaryColor, fontWeight: FontWeight.bold)),
              ),
          ],
        ),
      ),
    );
  }
}

// ================== MAIN CHAT SCREEN (Destination after Login) ==================
class MainChatScreen extends StatefulWidget {
  const MainChatScreen({super.key});

  @override
  State<MainChatScreen> createState() => _MainChatScreenState();
}

class _MainChatScreenState extends State<MainChatScreen> {
  String currentContext = 'Education services';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7F9),
      appBar: AppBar(
        title: const Text('GENIE.AI', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        backgroundColor: kPrimaryColor,
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(icon: const Icon(Icons.search), onPressed: () {}),
           // Simulate Logout for prototype
          IconButton(icon: const Icon(Icons.exit_to_app), onPressed: () {
             Navigator.pushReplacementNamed(context, '/login');
          }),
        ],
      ),
      drawer: _buildKnowledgeDrawer(),
      body: Column(
        children: [
          // Context Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: Colors.white,
            child: Row(children: [
                const Text("Query Context: ", style: TextStyle(fontWeight: FontWeight.bold)),
                Chip(label: Text(currentContext, style: const TextStyle(fontSize: 12)), backgroundColor: const Color(0xFFE1F5FE)),
            ]),
          ),
          // Chat Area Placeholder
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                 _buildChatBubble("Are there Muslim boarding schools available?", true),
                 _buildChatBubble("Yes, there are Muslim boarding schools available in Kenya. These institutions, often referred to as Madrasahs...", false),
              ],
            ),
          ),
          // Input Area Placeholder
          Container(
            padding: const EdgeInsets.all(12),
            color: Colors.white,
             child: Row(children: [
               const Expanded(child: TextField(decoration: InputDecoration(hintText: "Type your query here...", contentPadding: EdgeInsets.symmetric(horizontal: 12)))),
               const SizedBox(width: 8),
               FloatingActionButton(mini: true, onPressed: (){}, backgroundColor: kPrimaryColor, child: const Icon(Icons.send, color: Colors.white),)
             ]),
          )
        ],
      ),
    );
  }

  Widget _buildChatBubble(String text, bool isUser) {
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.all(12),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: isUser ? kPrimaryColor : Colors.white,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [BoxShadow(color: Colors.grey.withOpacity(0.1), blurRadius: 4)],
        ),
        child: Text(text, style: TextStyle(color: isUser ? Colors.white : Colors.black87)),
      ),
    );
  }

   Widget _buildKnowledgeDrawer() {
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
           const UserAccountsDrawerHeader(
            decoration: BoxDecoration(color: kPrimaryColor),
            accountName: Text("Fordendk"),
            accountEmail: Text("fordendk@example.com"),
            currentAccountPicture: CircleAvatar(backgroundColor: Colors.white, child: Text("F", style: TextStyle(color: kPrimaryColor, fontSize: 24))),
          ),
          ListTile(leading: const Icon(Icons.school), title: const Text('Education & Learning'), onTap: () { Navigator.pop(context); setState(() => currentContext = 'Education & Learning');}),
          ListTile(leading: const Icon(Icons.health_and_safety), title: const Text('Healthcare'), onTap: () {Navigator.pop(context); setState(() => currentContext = 'Healthcare');}),
        ],
      ),
    );
  }
}

// ================== SHARED WIDGETS ==================

// Helper widget for consistent TextFields with labels
Widget _buildLabeledTextField(String label, String hint, {bool isPassword = false}) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 16.0),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.black87)),
        const SizedBox(height: 8),
        TextField(
          obscureText: isPassword,
          decoration: InputDecoration(hintText: hint),
        ),
      ],
    ),
  );
}

// Helper widget for Social Media Buttons
Widget _buildSocialButton(String text, IconData icon, Color color) {
    return SizedBox(
      width: double.infinity,
      height: 50,
      child: OutlinedButton.icon(
        onPressed: () {},
        icon: Icon(icon, color: color),
        label: Text(text, style: const TextStyle(color: Colors.black87)),
        style: OutlinedButton.styleFrom(
          side: BorderSide(color: Colors.grey.shade300),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    );
  }