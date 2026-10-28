/**
 * Dormigo AI Chatbot Frontend Controller
 * Powers natural conversation, system knowledge queries, and clean minimal responsive UI.
 */
(function () {
  'use strict';

  let isOpen = false;
  let isExpanded = false;
  let conversationHistory = [];

  function getCurrentTimeStr() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function initDormigo() {
    const root = document.getElementById('dormigoRoot');
    if (!root) return;

    const toggleBtn = document.getElementById('dormigoToggleBtn');
    const closeBtn = document.getElementById('dormigoCloseBtn');
    const expandBtn = document.getElementById('dormigoExpandBtn');
    const expandIcon = document.getElementById('dormigoExpandIcon');
    const clearBtn = document.getElementById('dormigoClearBtn');
    const windowEl = document.getElementById('dormigoWindow');
    const form = document.getElementById('dormigoForm');
    const input = document.getElementById('dormigoInput');
    const messages = document.getElementById('dormigoMessages');
    const typing = document.getElementById('dormigoTyping');
    const initialTime = document.getElementById('dormigoInitialTime');

    // Set initial greeting dynamic time
    if (initialTime) {
      initialTime.textContent = getCurrentTimeStr();
    }

    // Toggle Chat Window
    function openChat() {
      isOpen = true;
      windowEl.style.display = 'flex';
      requestAnimationFrame(() => {
        windowEl.classList.add('dormigo-window-open');
      });
      if (input) input.focus();
      scrollToBottom();
    }

    function closeChat() {
      isOpen = false;
      windowEl.classList.remove('dormigo-window-open');
      setTimeout(() => {
        if (!isOpen) windowEl.style.display = 'none';
      }, 300);
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (isOpen) closeChat();
        else openChat();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', closeChat);
    }

    // Expand / Maximize Window Toggle (Desktop)
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        isExpanded = !isExpanded;
        if (isExpanded) {
          windowEl.classList.add('dormigo-expanded');
          if (expandIcon) expandIcon.setAttribute('data-lucide', 'minimize-2');
        } else {
          windowEl.classList.remove('dormigo-expanded');
          if (expandIcon) expandIcon.setAttribute('data-lucide', 'maximize-2');
        }
        if (window.lucide) lucide.createIcons();
      });
    }

    // Clear Conversation & Restore Initial English Questions
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        conversationHistory = [];
        messages.innerHTML = `
          <!-- 1. Bot Initial Greeting Bubble -->
          <div class="flex gap-2.5 max-w-[92%] animate-fade-in">
            <div class="space-y-1 w-full">
              <div class="dormigo-msg-bot p-3.5 text-xs sm:text-sm text-slate-800 leading-relaxed">
                <p class="font-medium text-slate-900">Hello! I'm your Virtual Dormigo Assistant.</p>
                <p class="text-slate-700 mt-1">How can I help you today?</p>
                <div class="flex justify-end mt-1">
                  <span class="text-[10px] text-slate-400 font-medium">${getCurrentTimeStr()}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. Three System Questions in English -->
          <div id="dormigoQuickQuestions" class="flex flex-col items-end gap-2 my-2.5 w-full animate-fade-in">
            <button
              type="button"
              class="dormigo-quick-btn inline-block text-right text-white text-xs sm:text-sm font-medium py-2.5 px-4 rounded-full shadow-2xs cursor-pointer max-w-[92%]"
              data-prompt="What dorms are available near MinSU?"
            >
              What dorms are available near MinSU?
            </button>

            <button
              type="button"
              class="dormigo-quick-btn inline-block text-right text-white text-xs sm:text-sm font-medium py-2.5 px-4 rounded-full shadow-2xs cursor-pointer max-w-[92%]"
              data-prompt="What are the budget boarding houses in Bongabong?"
            >
              What are the budget boarding houses in Bongabong?
            </button>

            <button
              type="button"
              class="dormigo-quick-btn inline-block text-right text-white text-xs sm:text-sm font-medium py-2.5 px-4 rounded-full shadow-2xs cursor-pointer max-w-[92%]"
              data-prompt="How can I inquire and pay rent via GCash?"
            >
              How can I inquire and pay rent via GCash?
            </button>
          </div>
        `;
        if (window.lucide) lucide.createIcons();
      });
    }

    // Handle Quick Questions & Suggested Chips Click via Delegation
    messages.addEventListener('click', (e) => {
      const quickBtn = e.target.closest('.dormigo-quick-btn') || e.target.closest('.dormigo-chip');
      if (quickBtn) {
        const prompt = quickBtn.getAttribute('data-prompt') || quickBtn.innerText.trim();
        if (prompt) {
          sendMessage(prompt);
        }
      }
    });

    // Form Submit
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = (input.value || '').trim();
        if (text) {
          sendMessage(text);
          input.value = '';
        }
      });
    }

    function scrollToBottom() {
      if (messages) {
        messages.scrollTop = messages.scrollHeight;
      }
    }

    function formatMarkdown(text) {
      if (!text) return '';
      let formatted = text
        // Bold: **text**
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic: *text*
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Inline code: `text`
        .replace(/`(.*?)`/g, '<code class="bg-emerald-50 text-emerald-900 px-1 py-0.5 rounded text-[11px] font-mono">$1</code>')
        // Bullet list conversion
        .replace(/^\s*[-•]\s*(.*)$/gm, '<li class="ml-4 list-disc">$1</li>')
        // Numbered list conversion
        .replace(/^\s*(\d+)\.\s*(.*)$/gm, '<li class="ml-4 list-decimal"><strong>$1.</strong> $2</li>')
        // Line breaks
        .replace(/\n\n/g, '<div class="h-2"></div>')
        .replace(/\n/g, '<br>');
      return formatted;
    }

    async function sendMessage(userQuery) {
      const timeStr = getCurrentTimeStr();

      // 1. Render User Message (Right-aligned green pill bubble)
      const userBubble = document.createElement('div');
      userBubble.className = 'flex justify-end animate-fade-in';
      userBubble.innerHTML = `
        <div class="space-y-1 max-w-[85%] text-right">
          <div class="dormigo-msg-user inline-block px-4 py-2 text-xs sm:text-sm text-left leading-relaxed">
            ${escapeHtml(userQuery)}
          </div>
          <span class="block text-[10px] text-slate-400 pr-1">${timeStr}</span>
        </div>
      `;
      messages.appendChild(userBubble);
      scrollToBottom();

      conversationHistory.push({ role: 'user', content: userQuery });

      // 2. Show Typing Indicator
      if (typing) typing.classList.remove('hidden');
      scrollToBottom();

      try {
        const response = await fetch('/api/dormigo/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userQuery,
            history: conversationHistory.slice(-6)
          })
        });

        const json = await response.json();
        if (typing) typing.classList.add('hidden');

        const replyData = json.data || {};
        const replyText = replyData.reply || 'Sorry, I am unable to process your request at the moment.';
        const actionCards = replyData.actionCards || [];
        const newSuggestions = replyData.suggestions || [];

        conversationHistory.push({ role: 'assistant', content: replyText });

        // 3. Render Bot Response (Left-aligned clean card)
        const botBubble = document.createElement('div');
        botBubble.className = 'flex gap-2.5 max-w-[92%] animate-fade-in';

        let actionCardsHtml = '';
        if (actionCards.length > 0) {
          actionCardsHtml = `
            <div class="mt-2.5 grid gap-1.5">
              ${actionCards.map(card => `
                <a href="${card.link}" class="flex items-center justify-between gap-2 rounded-xl bg-white hover:bg-emerald-50 border border-slate-200/90 px-3 py-2 text-xs font-semibold text-[#007a64] transition-all shadow-2xs group">
                  <div class="flex items-center gap-2">
                    <span class="flex h-5 w-5 items-center justify-center rounded-md bg-[#007a64] text-white text-[11px]">
                      <i data-lucide="${card.icon || 'arrow-right'}" class="h-3 w-3"></i>
                    </span>
                    <span>${card.label || card.title}</span>
                  </div>
                  <i data-lucide="chevron-right" class="h-3.5 w-3.5 text-[#007a64] transition-transform group-hover:translate-x-0.5"></i>
                </a>
              `).join('')}
            </div>
          `;
        }

        // Clean suggestions without loud emojis
        let followUpHtml = '';
        if (newSuggestions.length > 0) {
          followUpHtml = `
            <div class="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-slate-200/50">
              ${newSuggestions.slice(0, 3).map(s => `
                <button type="button" class="dormigo-chip inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-2xs hover:border-[#007a64]" data-prompt="${escapeHtml(s)}">
                  <span>${escapeHtml(s)}</span>
                </button>
              `).join('')}
            </div>
          `;
        }

        botBubble.innerHTML = `
          <div class="space-y-1 w-full">
            <div class="dormigo-msg-bot p-3.5 text-xs sm:text-sm text-slate-800 leading-relaxed">
              <div>${formatMarkdown(replyText)}</div>
              ${actionCardsHtml}
              ${followUpHtml}
              <div class="flex justify-end mt-1.5">
                <span class="text-[10px] text-slate-400 font-medium">${getCurrentTimeStr()}</span>
              </div>
            </div>
          </div>
        `;

        messages.appendChild(botBubble);
        scrollToBottom();

        if (window.lucide) lucide.createIcons();

      } catch (err) {
        console.error('Dormigo error:', err);
        if (typing) typing.classList.add('hidden');
        const errBubble = document.createElement('div');
        errBubble.className = 'flex gap-2.5 max-w-[90%] animate-fade-in';
        errBubble.innerHTML = `
          <div class="dormigo-msg-bot p-3 text-xs text-red-700 bg-red-50 border-red-200 rounded-xl">
            Unable to connect to server. Please try again later.
          </div>
        `;
        messages.appendChild(errBubble);
        scrollToBottom();
        if (window.lucide) lucide.createIcons();
      }
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDormigo);
  } else {
    initDormigo();
  }
})();
