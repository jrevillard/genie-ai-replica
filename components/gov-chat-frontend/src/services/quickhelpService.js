// src/services/quickhelpService.js - Quick Help buttons (J.4, DEC-28)
// Admin-managed button set served by the backend (quickhelpButtons
// collection). GET is authed; mutations are admin-only server-side.
import httpService from './httpService';

export default {
  /**
   * Enabled buttons for the chat page, sorted by order.
   * @returns {Promise<Array>} Button documents
   */
  async getButtons() {
    const response = await httpService.get('quickhelp');
    return response.data || [];
  },

  /**
   * All buttons (incl. disabled) for the admin panel.
   */
  async getAllButtons() {
    const response = await httpService.get('quickhelp', { params: { all: '1' } });
    return response.data || [];
  },

  async createButton(button) {
    const response = await httpService.post('quickhelp', button);
    return response.data;
  },

  async updateButton(id, button) {
    const response = await httpService.put(`quickhelp/${id}`, button);
    return response.data;
  },

  async deleteButton(id) {
    const response = await httpService.delete(`quickhelp/${id}`);
    return response.data;
  },
};
