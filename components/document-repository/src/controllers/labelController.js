const labelService = require('../services/labelService');

// Get all labels or filter by level/status
exports.getLabels = async (req, res) => {
  try {
    const { level, status, parentId } = req.query;
    const labels = await labelService.getLabels({ level, status, parentId });
    res.status(200).json(labels);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch labels', details: error.message });
  }
};

// Create a new label
exports.createLabel = async (req, res) => {
  try {
    const { name, level, status, publish_date, parentId } = req.body;

    const newLabel = await labelService.createLabel({
      name,
      level,
      status,
      publish_date,
      parent_id: parentId || null, // Set parent_id to null if not provided (for category labels)
      version: 1, // Default version
    });

    res.status(201).json(newLabel);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create label', details: error.message });
  }
};

// Update a label by ID
exports.updateLabel = async (req, res) => {
  try {
    const { labelId } = req.params;
    const updates = req.body;

    const updatedLabel = await labelService.updateLabel(labelId, updates);
    res.status(200).json(updatedLabel);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update label', details: error.message });
  }
};

// Delete a label by ID
exports.deleteLabel = async (req, res) => {
  try {
    const { labelId } = req.params;

    await labelService.deleteLabel(labelId);
    res.status(200).json({ message: 'Label deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete label', details: error.message });
  }
};

// Get related labels (parent and children)
exports.getRelatedLabels = async (req, res) => {
  try {
    const { labelId } = req.params;

    const relatedLabels = await labelService.getRelatedLabels(labelId);
    res.status(200).json(relatedLabels);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch related labels', details: error.message });
  }
};