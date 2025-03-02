

import random
import pandas as pd
import json
from datasets import load_dataset, Dataset


# Define datasets and corresponding column mappings
datasets_to_load = [
    "huggingface/dataset",            # Hugging Face dataset
    "your/custom/dataset.json"        # Local file
]

# Define column mapping for multiple datasets
column_mapping = {
    "huggingface/dataset": {
        "question": "question_test",
        "passage": "context_test",
        "answers": "answer_test"
    },
    "your/custom/dataset.json": {
        "column_name_1": "question_test",
        "column_name_2": "context_test",
        "column_name_3": "answer_test"
    }
}


def load_dataset(source, column_mapping, split="train", num_samples=10):
    """
    Load a dataset from Hugging Face or a local file.

    Parameters:
        source (str): Hugging Face dataset name or local file path (.csv, .json, .xlsx).
        column_mapping (dict): Mapping of dataset columns to standardized names.
        split (str): Dataset split (e.g., 'train', 'test', 'validation') for Hugging Face datasets.
        num_samples (int): Number of random samples to select.

    Returns:
        pd.DataFrame: Processed dataset as a Pandas DataFrame.
    """

    # Load from local file
    if source.endswith((".csv", ".json", ".xlsx")):
        if source.endswith(".csv"):
            df = pd.read_csv(source)
        elif source.endswith(".json"):
            df = pd.read_json(source)
        elif source.endswith(".xlsx"):
            df = pd.read_excel(source)
        else:
            raise ValueError("Unsupported file format. Use CSV, JSON, or XLSX.")

    # Load from Hugging Face datasets
    else:
        dataset = load_dataset(source, split=split)
        df = dataset.to_pandas()

    # Rename columns based on mapping
    df = df.rename(columns=column_mapping)

    # Keep only standardized columns
    standardized_columns = ["question_test", "context_test", "answer_test"]
    df = df[[col for col in standardized_columns if col in df.columns]]

    # Take random samples
    return df.sample(n=min(num_samples, len(df)), random_state=42)


def assemble_custom_dataset(dataset_sources, column_mappings, num_samples=10):
    """
    Load, sample, and merge datasets into a single DataFrame.

    Parameters:
        dataset_sources (list): List of dataset sources (Hugging Face or local paths).
        column_mappings (dict): Dictionary mapping dataset sources to standardized columns.
        num_samples (int): Number of random samples per dataset.

    Returns:
        pd.DataFrame: Merged dataset.
    """
    all_samples = []

    for source in dataset_sources:
        column_mapping = column_mappings.get(source, {})
        sampled_df = load_dataset(source, column_mapping, num_samples=num_samples)
        all_samples.append(sampled_df)

    # Concatenate all datasets
    combined_df = pd.concat(all_samples, ignore_index=True)
    return combined_df


def main():
    """
    Main function to load, process, and save datasets.
    """
    try:
        # Load, sample, and merge datasets
        combined_dataset = assemble_custom_dataset(datasets_to_load, column_mapping, num_samples=5)

        # Save to CSV
        combined_dataset.to_csv("custom_dataset.csv", index=False)
        print("Final dataset saved as custom_dataset.csv")

        # Save to JSON
        combined_dataset.to_json("custom_dataset.json", orient='records', indent=4)
        print("Final dataset saved as custom_dataset.json")

        # Save to Excel
        combined_dataset.to_excel("custom_dataset.xlsx", index=False)
        print("Final dataset saved as custom_dataset.xlsx")

    except Exception as e:
        print(f"Error: {e}")


# Run the script only if executed directly
if __name__ == "__main__":
    main()