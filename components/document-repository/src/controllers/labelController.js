const labelService = require('../services/labelService');
const { logger } = require('../../shared-lib');


// Get a label by its _key (the id)
exports.getLabelById = async (req, res) => {
  try {
    const { labelId } = req.params; // Extract the label ID (_key) from the route parameter
    const label = await labelService.getLabelById(labelId); // Call the service to fetch the label
    res.status(200).json(label); // Return the label as a JSON response
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch label', details: error.message });
  }
};


// Get all labels or filter by level/status
exports.getLabels = async (req, res) => {
  try {
    const { name, level, status, parentId, publish } = req.query;
    const labels = await labelService.getLabels({ name, level, status, parentId, publish });
    res.status(200).json(labels);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch labels', details: error.message });
  }
};


// Create a new label
exports.createLabel = async (req, res) => {
  try {
    const { name, level, status, publish, parentId } = req.body;

    const newLabel = await labelService.createLabel({
      name,
      level,
      status,
      publish,
      parentId: parentId || null, // Set parent_id to null if not provided (for category labels)
    });

    res.status(201).json(newLabel);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create label', details: error });// error.message  might expose internal details; consider sanitizing in production
  }
};


// Update a label by ID
exports.updateLabel = async (req, res) => {
  try {
    const { labelId } = req.params;
    const updates = req.body;
    logger.info('🧪 Update Label ID:' + labelId);
    logger.info('🧪 Update Label Payload:' + JSON.stringify(updates));

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


// Delete a category label and its children
exports.deleteCategoryWithChildren = async (req, res) => {
  try {
    const { labelId } = req.params;

    await labelService.deleteCategoryWithChildren(labelId);
    res.status(200).json({ message: 'Label and its children deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete category label with children', details: error.message });
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