# src/ingestion/arcadedb_schema.py
 
"""
Creates the ArcadeDB schema for the Chunk document type.
Run this BEFORE ingestion to ensure the type exists.
"""
 
from src.utils.arcade_client import command_sql

#Original schema function
#ef create_schema():
#   """Create the Chunk type and its properties in ArcadeDB."""
#   print("Creating ArcadeDB schema...")
#
#   # Create document type
#   try:
#       command_sql("CREATE DOCUMENT TYPE chunks IF NOT EXISTS")
#       print("  ✓ chunks type created")
#   except Exception as e:
#       print(f"  chunks type: {e}")
#
#   # Create properties
#   properties = [
#       ("chunk_id", "STRING", None),
#       ("doc_id", "STRING", None),
#       ("title", "STRING", None),
#       ("source", "STRING", None),
#       ("text", "STRING", None),
#       ("embedding", "LIST", "DOUBLE"),
#       ("category_labels", "LIST", "STRING"),
#       
#       
#   ]
#
#   for name, ptype in properties:
#       try:
#           command_sql(f"CREATE PROPERTY chunks.{name} IF NOT EXISTS {ptype} OF {ltype}")
#           print(f"  ✓ chunks.{name} ({ptype})")
#       except Exception as e:
#           print(f"  chunks.{name}: {e}")
#
#   # Create index on chunk_id for fast lookups
#   try:
#       command_sql("CREATE INDEX ON chunks (chunk_id) UNIQUE")
#       print("  ✓ Index on chunk_id")
#   except Exception as e:
#       print(f"  Index: {e}")
#
#   print("Schema creation complete.")


def create_collection(collection:str,collection_type:str='DOCUMENT'):
    try:
        command_sql(f"CREATE {collection_type} TYPE {collection} IF NOT EXISTS")
        print(f"  ✓ {collection} type ensured")
    except Exception as e:
        print(f"  {collection} type: {e}")

def create_properties(collection:str, properties:list):
    for name, ptype, lst_type in properties:
        try:
            script = f"CREATE PROPERTY {collection}.{name} IF NOT EXISTS {ptype}"
            script = script + f" OF {lst_type}" if ptype=='LIST' else script
            
            command_sql(script)
            print(f"  ✓ {collection}.{name} ({ptype}) ensured")
        except Exception as e:
            print(f"  {collection}.{name}: {e}")

def create_indexes(collection:str, indexes:list):
    for property, idx_type in indexes:
        try:
            command_sql(f"CREATE INDEX IF NOT EXISTS ON {collection} ({property}) {idx_type}")
            print(f"  ✓ Index on {property} ensured")
        except Exception as e:
            print(f"  Index: {e}")

def create_edges(relationships:list):
    for rel in relationships:
        try:
            command_sql(f"CREATE EDGE TYPE {rel} IF NOT EXISTS")
            print(f"  ✓ Edge relationship {rel} ensured")
        except Exception as e:
            print(f"  Edge relationship: {e}")
    
 
def create_schema():
    """Create schema in ArcadeDB."""
    print("Creating ArcadeDB schema...")
    
    # NOTE: DO NOT drop chunks — previous ingestion data must be preserved.
    # The old code had DROP TYPE Chunks here, which wiped all data on every restart.
 
    #Chunks collection ----------------------------------------------------
    create_collection(collection='chunks',collection_type='VERTEX')

    properties = [
        ("chunk_id", "STRING", None),
        ("doc_id", "STRING", None),
        ("title", "STRING", None),
        ("source", "STRING", None),
        ("text", "STRING", None),
        ("embedding", "LIST", "DOUBLE"),
        ("category_labels", "LIST", "STRING"),
        ("graph_enriched","BOOLEAN",None),
    ]
    create_properties(collection='chunks',properties=properties)
    
    indexes = [
        ("embedding", "LSM_VECTOR METADATA { \"dimensions\": 384, \"similarity\": \"COSINE\" }"),
        ("text", "FULL_TEXT"),
        ("chunk_id", "UNIQUE"),
        ("category_labels", "NOTUNIQUE")
    ]
    create_indexes(collection='chunks',indexes=indexes)
    
    #Documents collection ----------------------------------------------------
    create_collection(collection='documents',collection_type='VERTEX')
    
    properties = [("doc_id", "STRING", None)]
    create_properties(collection='documents',properties=properties)
    
    indexes = [("doc_id", "UNIQUE")]
    create_indexes(collection='documents',indexes=indexes)
    
    
    #Entities collection ----------------------------------------------------
    create_collection(collection='entities',collection_type='VERTEX')
    
    properties = [("name", "STRING", None)]
    create_properties(collection='entities',properties=properties)
    
    indexes = [("name", "UNIQUE")]
    create_indexes(collection='entities',indexes=indexes)
    
    
    #Edges --------------------------------------------------------------
    relationships = ['document_chunks','chunk_entities','relationships']
    create_edges(relationships=relationships)
 
 
    
    #Users collection ----------------------------------------------------
    create_collection(collection='users',collection_type='DOCUMENT')

    properties = [
        ("loginName", "STRING", None),
        ("email", "STRING", None),
        ("encPassword", "STRING", None),
        ("emailVerified", "BOOLEAN", None),
        ("personalIdentification", "MAP", None),
        ("addressResidency", "MAP", None),
        ("createdAt", "DATETIME", None),
        ("updatedAt", "DATETIME", None)
    ]
    create_properties(collection='users',properties=properties)
    
    indexes = [
        ("loginName", "UNIQUE"),
        ("email", "UNIQUE")
    ]
    create_indexes(collection='users',indexes=indexes)
    
    
    #Conversations collection ----------------------------------------------------
    create_collection(collection='conversations',collection_type='DOCUMENT')

    properties = [
        ("userId", "STRING", None),
        ("title", "STRING", None),
        ("lastMessage", "STRING", None),
        ("created", "DATETIME", None),
        ("updated", "DATETIME", None),
        ("messageCount", "INTEGER", None),
        ("isStarred", "BOOLEAN", None),
        ("isArchived", "BOOLEAN", None)
    ]
    create_properties(collection='conversations',properties=properties)
    
    indexes = [("userId", "UNIQUE")]
    create_indexes(collection='conversations',indexes=indexes)
    
    
    #Messages collection ----------------------------------------------------
    create_collection(collection='messages',collection_type='DOCUMENT')

    properties = [
        ("conversationId", "STRING", None),
        ("content", "STRING", None),
        ("sender", "STRING", None),
        ("sequence", "INTEGER", None),
        ("timestamp", "DATETIME", None),
        ("readStatus", "BOOLEAN", None)
    ]
    create_properties(collection='messages',properties=properties)
    
    indexes = [("conversationId, sequence", "UNIQUE")]
    create_indexes(collection='messages',indexes=indexes)
    
    
    #Queries collection ----------------------------------------------------
    create_collection(collection='queries',collection_type='DOCUMENT')

    properties = [
        ("userId", "STRING", None),
        ("sessionId", "STRING", None),
        ("text", "STRING", None),
        ("response", "STRING", None),
        ("isAnswered", "BOOLEAN", None),
        ("responseTime", "FLOAT", None),
        ("categoryId", "STRING", None),
        ("timestamp", "DATETIME", None)
    ]
    create_properties(collection='queries',properties=properties)
    
    indexes = [
        ("userId", "UNIQUE"),
        ("sessionId", "UNIQUE")
    ]
    create_indexes(collection='queries',indexes=indexes)
    
    
    #Categories collection ----------------------------------------------------
    create_collection(collection='categories',collection_type='DOCUMENT')

    properties = [
        ("catCode", "STRING", None),
        ("order", "INTEGER", None)
    ]
    create_properties(collection='categories',properties=properties)
    
    indexes = [("catCode", "UNIQUE")]
    create_indexes(collection='categories',indexes=indexes)
    
    #------------------------------------------------------------------------------
    print("Schema creation complete.")
 
 
if __name__ == "__main__":
    create_schema()
 