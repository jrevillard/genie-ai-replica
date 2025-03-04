<template>
  <div class="chat-history">
    <h4>Chat History</h4>
    <ul>
      <li
        v-for="(chat, index) in chats"
        :key="index"
        @click="$emit('selectChat', chat)"
      >
        {{ chat.title || 'Untitled Chat' }}
        <span class="date">{{ chat.date }}</span>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  name: 'ChatHistoryComponent',
  data() {
    return {
      chats: [
        { id: 1, title: 'Tax Inquiry', date: '2025-02-27' },
        { id: 2, title: 'Fire Safety', date: '2025-02-26' }
      ]
    }
  }
}
</script>

<style scoped>
.chat-history {
  margin-top: 20px;
}
.chat-history ul {
  list-style: none;
  padding: 0;
}
.chat-history li {
  padding: 5px;
  cursor: pointer;
  border-bottom: 1px solid #ccc;
}
.chat-history li:hover {
  background-color: #f0f0f0;
}
.date {
  font-size: 0.8em;
  color: #888;
  margin-left: 8px;
}
</style>

