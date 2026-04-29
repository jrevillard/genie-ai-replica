import os
from haystack.dataclasses import ChatMessage
from haystack.components.builders import ChatPromptBuilder

def load_template_from_file(template_name: str) -> list[ChatMessage]:
    """Reads a self-contained .jinja file and converts it to a ChatMessage list."""
    filepath = os.path.join("src", "prompts", f"{template_name}.jinja")
    
    # We use encoding="utf-8" to be safe with any special medical characters!
    with open(filepath, "r", encoding="utf-8") as f:
        system_text = f.read()
        
    return [
        ChatMessage.from_system(system_text),
        ChatMessage.from_user("Question: {{ query }}\n")
    ]

# Define the variables that EVERY prompt will need
req_vars = ['query', 'documents', 'history', 'user_age', 'user_gender']
req_vars_smalltalk = ['query', 'history', 'user_age', 'user_gender']

# Factory Dictionary
PROMPT_BUILDERS = {
    "builder_assistant": ChatPromptBuilder(
        template=load_template_from_file("template_assistant"), 
        required_variables=req_vars
    ),
    "builder_triage": ChatPromptBuilder(
        template=load_template_from_file("template_triage"), 
        required_variables=req_vars
    ),
    "builder_smalltalk": ChatPromptBuilder(
        template=load_template_from_file("template_smalltalk"), 
        required_variables=req_vars_smalltalk
    )
}