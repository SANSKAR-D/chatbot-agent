export default function Sidebar({
  chats,
  activeChatId,
  isStreaming,
  isSidebarOpen,
  setIsSidebarOpen,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onClearHistory,
}) {
  return (
    <>
      {/* Mobile Sidebar Backdrop overlay */}
      <div
        className={`sidebar-backdrop ${isSidebarOpen ? 'open' : ''}`}
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sliding Sidebar Drawer */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="brand-icon">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M12 2v4"></path>
              <path d="M8 5h8"></path>
              <path d="M12 11V6"></path>
            </svg>
            <span>Agentic Chatbot</span>
          </div>
          <button className="new-chat-btn" onClick={onNewChat} disabled={isStreaming}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Chat
          </button>
        </div>

        <div className="chat-list-container">
          <div className="chat-list">
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={`chat-item-wrapper ${chat.id === activeChatId ? 'active' : ''} ${isStreaming ? 'disabled' : ''}`}
              >
                <button
                  className="chat-item"
                  onClick={() => onSelectChat(chat.id)}
                  title={chat.title}
                  disabled={isStreaming}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>{chat.title}</span>
                </button>
                <button
                  className="delete-chat-btn"
                  onClick={(e) => onDeleteChat(chat.id, e)}
                  title="Delete chat"
                  disabled={isStreaming}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="clear-history-btn" onClick={onClearHistory} disabled={isStreaming}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Clear all chats
          </button>
          <div className="footer-info">ChatBot v1.0</div>
        </div>
      </aside>
    </>
  );
}
