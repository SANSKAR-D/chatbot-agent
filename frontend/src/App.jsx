import { useState, useRef, useEffect, useMemo } from 'react';
import './index.css';
import './App.css';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import MessageList from './components/MessageList';
import MessageInput from './components/MessageInput';
import ConfirmModal from './components/ConfirmModal';
import BlogProgress from './components/BlogProgress';

function App() {
  const [appMode, setAppMode] = useState(() => {
    return localStorage.getItem('chatbot_app_mode') || 'chat';
  });

  useEffect(() => {
    localStorage.setItem('chatbot_app_mode', appMode);
  }, [appMode]);

  // Helper to load initial chats from localStorage or fallback to default new chat
  const getInitialChats = (prefix, defaultTitle) => {
    const saved = localStorage.getItem(`chatbot_${prefix}s`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.error(`Error parsing ${prefix}s from localStorage`, e);
      }
    }
    return [{ id: `${prefix}_` + Date.now(), title: defaultTitle, messages: [], blogState: {} }];
  };

  const initialChats = getInitialChats('chat', 'New Chat');
  const [chats, setChats] = useState(initialChats);
  
  const initialBlogs = getInitialChats('blog', 'New Blog');
  const [blogThreads, setBlogThreads] = useState(initialBlogs);

  const [activeChatId, setActiveChatId] = useState(() => {
    const saved = localStorage.getItem('chatbot_active_chat_id');
    if (saved && initialChats.some(c => c.id === saved)) return saved;
    return initialChats[0]?.id || '';
  });
  
  const [activeBlogId, setActiveBlogId] = useState(() => {
    const saved = localStorage.getItem('chatbot_active_blog_id');
    if (saved && initialBlogs.some(c => c.id === saved)) return saved;
    return initialBlogs[0]?.id || '';
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
    localStorage.setItem('chatbot_blogs', JSON.stringify(blogThreads));
  }, [blogThreads]);

  useEffect(() => {
    localStorage.setItem('chatbot_active_chat_id', activeChatId);
  }, [activeChatId]);
  
  useEffect(() => {
    localStorage.setItem('chatbot_active_blog_id', activeBlogId);
  }, [activeBlogId]);

  // Sync threads on mount
  useEffect(() => {
    const syncChatThreads = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8000/chat/threads');
        if (response.ok) {
          const data = await response.json();
          if (data && data.threads && data.threads.length > 0) {
            setActiveChatId((currentId) => {
              if (currentId && currentId.startsWith('chat_') && !data.threads.some(t => t.id === currentId)) {
                return data.threads[0].id;
              }
              return currentId;
            });
            setChats((prevChats) => {
              const mergedChats = [...prevChats];
              data.threads.forEach((backendThread) => {
                if (!mergedChats.some((c) => c.id === backendThread.id)) {
                  mergedChats.push({ id: backendThread.id, title: backendThread.title, messages: [] });
                }
              });
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
      } catch (error) { console.error("Error syncing chats:", error); }
    };
    
    const syncBlogThreads = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8000/blog/threads');
        if (response.ok) {
          const data = await response.json();
          if (data && data.threads && data.threads.length > 0) {
            setActiveBlogId((currentId) => {
              if (currentId && currentId.startsWith('blog_') && !data.threads.some(t => t.id === currentId)) {
                return data.threads[0].id;
              }
              return currentId;
            });
            setBlogThreads((prevBlogs) => {
              const mergedBlogs = [...prevBlogs];
              data.threads.forEach((backendThread) => {
                if (!mergedBlogs.some((c) => c.id === backendThread.id)) {
                  mergedBlogs.push({ id: backendThread.id, title: backendThread.title, blogState: {} });
                }
              });
              if (mergedBlogs.length > 1) {
                const firstBlog = mergedBlogs[0];
                if (firstBlog && firstBlog.title === 'New Blog' && (!firstBlog.blogState || Object.keys(firstBlog.blogState).length === 0)) {
                  return mergedBlogs.filter((c) => c.id !== firstBlog.id);
                }
              }
              return mergedBlogs;
            });
          }
        }
      } catch (error) { console.error("Error syncing blogs:", error); }
    };

    syncChatThreads();
    syncBlogThreads();
  }, []);

  // Fetch chat history
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
        } catch (error) { console.error("Error fetching chat history:", error); }
      };
      fetchHistory();
    }
  }, [activeChatId]);
  
  // Fetch blog history
  useEffect(() => {
    if (!activeBlogId) return;
    const currentBlog = blogThreads.find((c) => c.id === activeBlogId);
    if (currentBlog && (!currentBlog.blogState || !currentBlog.blogState.finalMarkdown)) {
      const fetchBlogHistory = async () => {
        try {
          const response = await fetch(`http://127.0.0.1:8000/blog/history/${activeBlogId}`);
          if (response.ok) {
            const data = await response.json();
            if (data && data.final_markdown) {
              setBlogThreads((prevBlogs) =>
                prevBlogs.map((blog) => {
                  if (blog.id === activeBlogId) {
                    let newTitle = data.topic || blog.title;
                    return { 
                      ...blog, 
                      title: newTitle, 
                      blogState: { 
                        isGenerating: false, 
                        currentNode: '', 
                        message: '', 
                        finalMarkdown: data.final_markdown 
                      } 
                    };
                  }
                  return blog;
                })
              );
            }
          }
        } catch (error) { console.error("Error fetching blog history:", error); }
      };
      fetchBlogHistory();
    }
  }, [activeBlogId]);

  const activeChat = chats.find(c => c.id === activeChatId) || chats[0];
  const activeBlog = blogThreads.find(c => c.id === activeBlogId) || blogThreads[0];
  const messages = useMemo(() => activeChat?.messages || [], [activeChat]);

  const setMessages = (updater) => {
    setChats((prevChats) => {
      return prevChats.map((chat) => {
        if (chat.id === activeChatId) {
          const newMessages = typeof updater === 'function' ? updater(chat.messages) : updater;
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
  
  const updateActiveBlogState = (updater) => {
    setBlogThreads((prevBlogs) => {
      return prevBlogs.map((blog) => {
        if (blog.id === activeBlogId) {
          const newState = typeof updater === 'function' ? updater(blog.blogState || {}) : updater;
          return { ...blog, blogState: { ...(blog.blogState || {}), ...newState } };
        }
        return blog;
      });
    });
  };

  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (appMode === 'chat') {
      scrollToBottom(shouldScrollSmoothRef.current ? 'smooth' : 'auto');
      shouldScrollSmoothRef.current = true;
    }
  }, [messages, isStreaming, appMode]);

  const fetchChatStream = async (messageText, isResume = false) => {
    setIsStreaming(true);
    try {
      const response = await fetch('http://127.0.0.1:8000/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, thread_id: activeChatId, resume: isResume }),
      });
      if (!response.ok) throw new Error('Network error');

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
                if (newMessages[lastIndex]) {
                  newMessages[lastIndex] = { ...newMessages[lastIndex], isStreaming: false, isThinking: false };
                }
                return newMessages;
              });
              break;
            }

            try {
              const data = JSON.parse(dataStr);
              if (data.type === 'hitl_required') {
                const toolCall = data.tool_calls[0];
                setConfirmModal({
                  isOpen: true,
                  title: 'Approve Action',
                  message: `The AI is requesting an action. Do you approve?`,
                  confirmText: 'Approve',
                  onConfirm: () => fetchChatStream('', 'approve'),
                  onCancel: () => fetchChatStream('', 'reject')
                });
                return;
              } else if (data.chunk) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIndex = newMessages.length - 1;
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    text: (newMessages[lastIndex].text || '') + data.chunk,
                    isThinking: false
                  };
                  return newMessages;
                });
              } else if (data.error) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastIndex = newMessages.length - 1;
                  newMessages[lastIndex] = {
                    ...newMessages[lastIndex],
                    text: (newMessages[lastIndex].text || '') + "\n[Error: " + data.error + "]",
                    isStreaming: false,
                    isThinking: false
                  };
                  return newMessages;
                });
                setIsStreaming(false);
              }
            } catch (err) { console.error("Error parsing JSON", err); }
          }
        }
      }
    } catch (error) {
      setIsStreaming(false);
    }
  };

  const fetchBlogStream = async (topic, feedback = null) => {
    setIsStreaming(true);
    const initialMsg = feedback ? 'Revising blog based on feedback...' : 'Initializing blog generation...';
    const initialNode = feedback ? 'refine_node' : 'router_node';
    updateActiveBlogState({ isGenerating: true, currentNode: initialNode, message: initialMsg, finalMarkdown: '' });
    
    if (!feedback) {
      setBlogThreads(prev => prev.map(b => b.id === activeBlogId ? { ...b, title: topic.slice(0, 30) + (topic.length > 30 ? '...' : '') } : b));
    }

    try {
      const response = await fetch('http://127.0.0.1:8000/blog/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, thread_id: activeBlogId, feedback }),
      });
      if (!response.ok) throw new Error('Network error');

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
              updateActiveBlogState({ isGenerating: false });
              break;
            }

            try {
              const data = JSON.parse(dataStr);
              if (data.error) {
                updateActiveBlogState({ isGenerating: false, message: 'Error: ' + data.error });
                setIsStreaming(false);
              } else {
                updateActiveBlogState((prev) => ({
                  currentNode: data.node || prev.currentNode,
                  message: data.message || prev.message,
                  finalMarkdown: data.final_markdown || prev.finalMarkdown
                }));
              }
            } catch (err) { console.error("Error parsing JSON", err); }
          }
        }
      }
    } catch (error) {
      updateActiveBlogState({ isGenerating: false, message: 'Network error occurred.' });
      setIsStreaming(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || isStreaming) return;

    const userMessage = inputValue.trim();
    setInputValue('');

    if (appMode === 'chat') {
      setMessages((prev) => [...prev, { text: userMessage, sender: 'user' }]);
      setMessages((prev) => [...prev, { text: '', sender: 'bot', isStreaming: true, isThinking: true }]);
      fetchChatStream(userMessage, false);
    } else {
      const hasExistingBlog = Boolean(activeBlog?.blogState?.finalMarkdown);
      if (hasExistingBlog) {
        fetchBlogStream(activeBlog.title || 'Blog', userMessage);
      } else {
        fetchBlogStream(userMessage);
      }
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || appMode !== 'chat') return;
    
    if (file.type !== "application/pdf") {
      alert("Only PDF files are supported.");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("thread_id", activeChatId);
    
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
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleNewChat = () => {
    if (isStreaming) return;
    if (appMode === 'chat') {
      const newId = 'chat_' + Date.now();
      setChats((prev) => [{ id: newId, title: 'New Chat', messages: [] }, ...prev]);
      setActiveChatId(newId);
    } else {
      const newId = 'blog_' + Date.now();
      setBlogThreads((prev) => [{ id: newId, title: 'New Blog', blogState: {} }, ...prev]);
      setActiveBlogId(newId);
    }
    if (window.innerWidth <= 768) setIsSidebarOpen(false);
  };

  const handleSelectChat = (chatId) => {
    if (isStreaming) return;
    shouldScrollSmoothRef.current = false;
    if (appMode === 'chat') setActiveChatId(chatId);
    else setActiveBlogId(chatId);
    if (window.innerWidth <= 768) setIsSidebarOpen(false);
  };

  const handleDeleteChat = (chatId, e) => {
    e.stopPropagation();
    if (isStreaming) return;

    setConfirmModal({
      isOpen: true,
      title: appMode === 'chat' ? 'Delete Chat' : 'Delete Blog',
      message: 'Are you sure you want to delete this? This action cannot be undone.',
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          const endpoint = appMode === 'chat' ? `http://127.0.0.1:8000/chat/threads/${chatId}` : `http://127.0.0.1:8000/blog/threads/${chatId}`;
          await fetch(endpoint, { method: 'DELETE' });
        } catch (error) { console.error("Error deleting:", error); }

        if (appMode === 'chat') {
          const filtered = chats.filter((c) => c.id !== chatId);
          let nextChats = filtered, nextActiveId = activeChatId;
          if (filtered.length === 0) {
            const newId = 'chat_' + Date.now();
            nextChats = [{ id: newId, title: 'New Chat', messages: [] }];
            nextActiveId = newId;
          } else if (activeChatId === chatId) {
            nextActiveId = filtered[0].id;
          }
          setChats(nextChats);
          setActiveChatId(nextActiveId);
        } else {
          const filtered = blogThreads.filter((c) => c.id !== chatId);
          let nextBlogs = filtered, nextActiveId = activeBlogId;
          if (filtered.length === 0) {
            const newId = 'blog_' + Date.now();
            nextBlogs = [{ id: newId, title: 'New Blog', blogState: {} }];
            nextActiveId = newId;
          } else if (activeBlogId === chatId) {
            nextActiveId = filtered[0].id;
          }
          setBlogThreads(nextBlogs);
          setActiveBlogId(nextActiveId);
        }
      }
    });
  };

  const handleClearHistory = () => {
    if (isStreaming) return;

    setConfirmModal({
      isOpen: true,
      title: appMode === 'chat' ? 'Clear Chat History' : 'Clear Blog History',
      message: 'Are you sure you want to clear all history for this mode? This action cannot be undone.',
      confirmText: 'Clear All',
      onConfirm: async () => {
        try {
          const endpoint = appMode === 'chat' ? 'http://127.0.0.1:8000/chat/threads' : 'http://127.0.0.1:8000/blog/threads';
          await fetch(endpoint, { method: 'DELETE' });
        } catch (error) { console.error("Error clearing:", error); }

        if (appMode === 'chat') {
          const newId = 'chat_' + Date.now();
          setChats([{ id: newId, title: 'New Chat', messages: [] }]);
          setActiveChatId(newId);
        } else {
          const newId = 'blog_' + Date.now();
          setBlogThreads([{ id: newId, title: 'New Blog', blogState: {} }]);
          setActiveBlogId(newId);
        }
        if (window.innerWidth <= 768) setIsSidebarOpen(false);
      }
    });
  };
  
  // Decide if input bar should be shown: keep visible when not actively generating
  const showInput = appMode === 'chat' || !activeBlog?.blogState?.isGenerating;

  return (
    <div className="app-layout">
      <Sidebar
        chats={appMode === 'chat' ? chats : blogThreads}
        activeChatId={appMode === 'chat' ? activeChatId : activeBlogId}
        isStreaming={isStreaming}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onClearHistory={handleClearHistory}
        appMode={appMode}
      />

      <main className="main-content">
        <Header 
          activeChat={appMode === 'chat' ? activeChat : activeBlog} 
          isSidebarOpen={isSidebarOpen} 
          setIsSidebarOpen={setIsSidebarOpen} 
          appMode={appMode}
          setAppMode={setAppMode}
        />

        <div className="chat-container">
          {appMode === 'chat' ? (
            <MessageList messages={messages} messagesEndRef={messagesEndRef} setInputValue={setInputValue} />
          ) : (
            <BlogProgress blogState={activeBlog?.blogState || {}} />
          )}
          
          {showInput && (
            <MessageInput
              inputValue={inputValue}
              setInputValue={setInputValue}
              isStreaming={isStreaming}
              isUploading={isUploading}
              onSubmit={handleSubmit}
              onFileUpload={handleFileUpload}
              fileInputRef={fileInputRef}
              appMode={appMode}
              setAppMode={setAppMode}
              hasExistingBlog={Boolean(activeBlog?.blogState?.finalMarkdown)}
            />
          )}
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
        onCancel={() => {
          if (confirmModal.onCancel) confirmModal.onCancel();
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }}
      />
    </div>
  );
}

export default App;
