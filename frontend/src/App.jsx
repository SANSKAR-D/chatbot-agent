import { useState, useRef, useEffect, useMemo } from 'react';
import './index.css';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import MessageList from './components/MessageList';
import MessageInput from './components/MessageInput';
import ConfirmModal from './components/ConfirmModal';

function App() {
  // Helper to load initial chats from localStorage or fallback to default new chat
  const getInitialChats = () => {
    const saved = localStorage.getItem('chatbot_chats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.error("Error parsing chats from localStorage", e);
      }
    }
    return [{ id: 'chat_' + Date.now(), title: 'New Chat', messages: [] }];
  };

  const initialChats = getInitialChats();
  const [chats, setChats] = useState(initialChats);

  const [activeChatId, setActiveChatId] = useState(() => {
    const saved = localStorage.getItem('chatbot_active_chat_id');
    if (saved && initialChats.some(c => c.id === saved)) {
      return saved;
    }
    return initialChats[0]?.id || '';
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const shouldScrollSmoothRef = useRef(true);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    onConfirm: null
  });
  const messagesEndRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('chatbot_chats', JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem('chatbot_active_chat_id', activeChatId);
  }, [activeChatId]);

  // On mount, sync thread list from backend database
  useEffect(() => {
    const syncThreads = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8000/chat/threads');
        if (response.ok) {
          const data = await response.json();
          if (data && data.threads && data.threads.length > 0) {
            // Update activeChatId to the first restored thread if currently selecting the temporary "New Chat"
            setActiveChatId((currentId) => {
              if (currentId && currentId.startsWith('chat_') && !data.threads.some(t => t.id === currentId)) {
                return data.threads[0].id;
              }
              return currentId;
            });

            setChats((prevChats) => {
              const mergedChats = [...prevChats];
              data.threads.forEach((backendThread) => {
                // Add the chat if it is not already in the frontend list
                if (!mergedChats.some((c) => c.id === backendThread.id)) {
                  mergedChats.push({
                    id: backendThread.id,
                    title: backendThread.title,
                    messages: [] // Loaded on demand when selected
                  });
                }
              });

              // Remove the default empty "New Chat" if backend chats were restored
              if (mergedChats.length > 1) {
                const firstChat = mergedChats[0];
                if (firstChat && firstChat.title === 'New Chat' && firstChat.messages.length === 0) {
                  return mergedChats.filter((c) => c.id !== firstChat.id);
                }
              }

              return mergedChats;
            });
          }
        }
      } catch (error) {
        console.error("Error syncing threads from backend:", error);
      }
    };
    syncThreads();
  }, []);

  // Fetch chat history from backend if active chat has no messages
  useEffect(() => {
    if (!activeChatId) return;

    const currentChat = chats.find((c) => c.id === activeChatId);
    if (currentChat && currentChat.messages.length === 0) {
      const fetchHistory = async () => {
        try {
          const response = await fetch(`http://127.0.0.1:8000/chat/history/${activeChatId}`);
          if (response.ok) {
            const data = await response.json();
            if (data && data.messages && data.messages.length > 0) {
              setChats((prevChats) =>
                prevChats.map((chat) => {
                  if (chat.id === activeChatId) {
                    let newTitle = chat.title;
                    if (chat.title === 'New Chat' || chat.title === '') {
                      const firstUserMessage = data.messages.find((m) => m.sender === 'user');
                      if (firstUserMessage) {
                        newTitle = firstUserMessage.text.slice(0, 30);
                        if (firstUserMessage.text.length > 30) newTitle += '...';
                      }
                    }
                    return { ...chat, title: newTitle, messages: data.messages };
                  }
                  return chat;
                })
              );
            }
          }
        } catch (error) {
          console.error("Error fetching chat history:", error);
        }
      };
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0];
  const messages = useMemo(() => activeChat?.messages || [], [activeChat]);

  const setMessages = (updater) => {
    setChats((prevChats) => {
      return prevChats.map((chat) => {
        if (chat.id === activeChatId) {
          const newMessages = typeof updater === 'function' ? updater(chat.messages) : updater;

          // Auto-rename chat title if it's the default "New Chat" and contains a user message
          let newTitle = chat.title;
          if (chat.title === 'New Chat' || chat.title === '') {
            const firstUserMessage = newMessages.find((m) => m.sender === 'user');
            if (firstUserMessage) {
              newTitle = firstUserMessage.text.slice(0, 30);
              if (firstUserMessage.text.length > 30) newTitle += '...';
            }
          }

          return { ...chat, title: newTitle, messages: newMessages };
        }
        return chat;
      });
    });
  };

  // Auto-scroll to bottom
  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom(shouldScrollSmoothRef.current ? 'smooth' : 'auto');
    shouldScrollSmoothRef.current = true;
  }, [messages, isStreaming]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || isStreaming) return;

    const userMessage = inputValue.trim();
    setInputValue('');

    // Add user message to UI
    setMessages((prev) => [...prev, { text: userMessage, sender: 'user' }]);

    // Add an empty bot message that we will append to during streaming
    setMessages((prev) => [...prev, { text: '', sender: 'bot', isStreaming: true, isThinking: true }]);
    setIsStreaming(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          thread_id: activeChatId
        }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.replace('data: ', '').trim();
            if (dataStr === '[DONE]') {
              setIsStreaming(false);
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastIndex = newMessages.length - 1;
                newMessages[lastIndex] = { ...newMessages[lastIndex], isStreaming: false, isThinking: false };
                return newMessages;
              });
              break;
            }

            try {
              const data = JSON.parse(dataStr);
              if (data.chunk) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIndex = newMessages.length - 1;
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    text: newMessages[lastIndex].text + data.chunk,
                    isThinking: false
                  };
                  return newMessages;
                });
              } else if (data.error) {
                console.error("Server Error:", data.error);
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIndex = newMessages.length - 1;
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    text: newMessages[lastIndex].text + "\n[Error: " + data.error + "]",
                    isStreaming: false,
                    isThinking: false
                  };
                  return newMessages;
                });
                setIsStreaming(false);
              }
            } catch (err) {
              console.error("Error parsing JSON chunk", err, dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching stream:', error);
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;
        newMessages[lastIndex] = {
          ...newMessages[lastIndex],
          text: newMessages[lastIndex].text + "\n[Connection Error]",
          isStreaming: false,
          isThinking: false
        };
        return newMessages;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.type !== "application/pdf") {
      alert("Only PDF files are supported.");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("thread_id", activeChatId);
    
    // Add an optimistic system message
    setMessages((prev) => [...prev, { text: `Uploading ${file.name}...`, sender: 'bot', isSystem: true }]);

    try {
      const response = await fetch("http://127.0.0.1:8000/upload-pdf", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      
      if (response.ok && data.status === "success") {
        setMessages((prev) => [...prev, { text: `Successfully uploaded ${file.name}. You can now ask questions about it!`, sender: 'bot', isSystem: true }]);
      } else {
        setMessages((prev) => [...prev, { text: `Error uploading ${file.name}: ${data.message}`, sender: 'bot', isSystem: true }]);
      }
    } catch (error) {
      setMessages((prev) => [...prev, { text: `Network error uploading ${file.name}.`, sender: 'bot', isSystem: true }]);
    } finally {
      setIsUploading(false);
      // clear the input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Sidebar Actions
  const handleNewChat = () => {
    if (isStreaming) return;
    const newId = 'chat_' + Date.now();
    const newChat = { id: newId, title: 'New Chat', messages: [] };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newId);
    if (window.innerWidth <= 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleSelectChat = (chatId) => {
    if (isStreaming) return;
    shouldScrollSmoothRef.current = false;
    setActiveChatId(chatId);
    if (window.innerWidth <= 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleDeleteChat = (chatId, e) => {
    e.stopPropagation();
    if (isStreaming) return;

    setConfirmModal({
      isOpen: true,
      title: 'Delete Chat',
      message: 'Are you sure you want to delete this chat conversation? This action cannot be undone.',
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await fetch(`http://127.0.0.1:8000/chat/threads/${chatId}`, {
            method: 'DELETE',
          });
        } catch (error) {
          console.error("Error deleting chat:", error);
        }

        const filtered = chats.filter((c) => c.id !== chatId);
        let nextChats = filtered;
        let nextActiveId = activeChatId;

        if (filtered.length === 0) {
          const newId = 'chat_' + Date.now();
          nextChats = [{ id: newId, title: 'New Chat', messages: [] }];
          nextActiveId = newId;
        } else if (activeChatId === chatId) {
          nextActiveId = filtered[0].id;
        }

        setChats(nextChats);
        setActiveChatId(nextActiveId);
      }
    });
  };

  const handleClearHistory = () => {
    if (isStreaming) return;

    setConfirmModal({
      isOpen: true,
      title: 'Clear Chat History',
      message: 'Are you sure you want to clear all chat conversations? This action cannot be undone.',
      confirmText: 'Clear All',
      onConfirm: async () => {
        try {
          await fetch('http://127.0.0.1:8000/chat/threads', {
            method: 'DELETE',
          });
        } catch (error) {
          console.error("Error clearing chats:", error);
        }

        const newId = 'chat_' + Date.now();
        setChats([{ id: newId, title: 'New Chat', messages: [] }]);
        setActiveChatId(newId);
        if (window.innerWidth <= 768) {
          setIsSidebarOpen(false);
        }
      }
    });
  };

  return (
    <div className="app-layout">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        isStreaming={isStreaming}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onClearHistory={handleClearHistory}
      />

      <main className="main-content">
        <Header 
          activeChat={activeChat} 
          isSidebarOpen={isSidebarOpen} 
          setIsSidebarOpen={setIsSidebarOpen} 
        />

        <div className="chat-container">
          <MessageList messages={messages} messagesEndRef={messagesEndRef} />
          <MessageInput
            inputValue={inputValue}
            setInputValue={setInputValue}
            isStreaming={isStreaming}
            isUploading={isUploading}
            onSubmit={handleSubmit}
            onFileUpload={handleFileUpload}
            fileInputRef={fileInputRef}
          />
        </div>
      </main>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        onConfirm={() => {
          if (confirmModal.onConfirm) confirmModal.onConfirm();
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}

export default App;
