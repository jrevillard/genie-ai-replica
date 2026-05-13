<template>
  <div class="chat-history" :data-theme="$route.meta.theme || 'light'">
    <h4>{{ $t('sidebar.chatHistory', 'Chat History') }}</h4>
    <ul>
      <li v-for="(chat, index) in chats" :key="index" @click="$emit('selectChat', chat)">
        {{ chat.title || 'Untitled Chat' }}
        <span class="date">{{ chat.date }}</span>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  name: 'ChatHistoryComponent',
  emits: ['selectChat'],
  data() {
    return {
      chats: [
        { id: 1, title: 'Tax Inquiry', date: '2025-02-27' },
        { id: 2, title: 'Fire Safety', date: '2025-02-26' }
      ]
    };
  }
};
</script>

<style scoped>
.chat-history {
  margin-top: var(--space-lg);
  background-color: var(--surface);
  color: var(--fg);
  padding: var(--space-sm);
}

.chat-history h4 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 var(--space-md);
}

.chat-history ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.chat-history li {
  padding: var(--space-sm);
  cursor: pointer;
  border-bottom: 1px solid var(--border-light);
  color: var(--fg);
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background-color 0.2s;
}

.chat-history li:hover {
  background-color: var(--bg);
}

.date {
  font-size: 0.8em;
  color: var(--muted-soft);
  margin-left: var(--space-sm);
}
.chat-history h4 {
  color: var(--muted);
  font-size: var(--text-base);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
