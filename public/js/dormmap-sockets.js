/**
 * DorMap Real-Time WebSocket Client Controller
 * Powers live transactions, inquiries, notifications, and navigation synchronization across all pages.
 */
(function () {
  'use strict';

  const portal = ['/admin', '/barangay-dashboard', '/owner-dashboard', '/tenant-dashboard'];
  if (!portal.includes(location.pathname.replace(/\/$/, ''))) return;
  let socket = null;
  const isSocketIoAvailable = typeof window.io === 'function';

  if (!isSocketIoAvailable) {
    console.warn('⚠️ Socket.io client script not loaded yet. WebSocket initializing deferred.');
  }

  function initSocket() {
    try {
      if (typeof window.io !== 'function') return;

      socket = window.io({
        transports: ['websocket', 'polling'],
        timeout: 7000,
        reconnectionDelay: 1200,
        reconnectionDelayMax: 15000
      });

      window.DormMapSocket = {
        socket,
        emit: function (event, data) {
          if (socket) socket.emit(event, data);
        },
        on: function (event, callback) {
          if (socket) socket.on(event, callback);
        }
      };

      document.dispatchEvent(new CustomEvent('dormmap:socket-ready', { detail: socket }));

      socket.on('connect', () => {
        console.log('⚡ Connected to DorMap Real-Time WebSocket Server (ID:', socket.id, ')');

        // Check if user session data is present in DOM
        const userMeta = document.querySelector('meta[name="dormmap-user-id"]');
        const roleMeta = document.querySelector('meta[name="dormmap-user-role"]');
        const userId = userMeta ? userMeta.getAttribute('content') : window.__DORMMAP_USER_ID__;
        const role = roleMeta ? roleMeta.getAttribute('content') : window.__DORMMAP_USER_ROLE__;

        if (userId) socket.emit('join_user', userId);
        if (role) socket.emit('join_role', role);
      });

      // 1. REAL-TIME PAYMENT NOTIFICATIONS
      socket.on('payment_completed', (data) => {
        console.log('🔔 Payment completed event received:', data);
        window.DormMapFeedback?.show('Payment successful', 'success',
          `Payment of ₱${Number(data.amount || 0).toLocaleString()} for ${data.boardingHouseName || 'rent'} was confirmed.`);
        // Auto refresh table or data if handlers exist
        if (typeof window.reloadPaymentsTable === 'function') {
          window.reloadPaymentsTable();
        }
      });

      // 2. REAL-TIME INQUIRIES & CHAT
      socket.on('new_chat_message', (data) => {
        console.log('💬 New chat message received:', data);
        if (typeof window.handleIncomingSocketMessage === 'function') {
          window.handleIncomingSocketMessage(data);
        } else if (data.senderName) {
          window.DormMapFeedback?.show(`New message from ${data.senderName}`, 'info',
            data.message || 'You received a new inquiry.');
        }
      });

      // 3. ROOM AVAILABILITY SYNCHRONIZATION
      socket.on('room_slots_updated', (data) => {
        console.log('🏠 Room slots updated:', data);
        const slotEl = document.querySelector(`[data-room-slots="${data.roomId}"]`);
        if (slotEl) {
          slotEl.textContent = `${data.availableSlots} slots left`;
        }
      });

      // 4. REAL-TIME SYSTEM NOTIFICATIONS
      socket.on('system_notification', (data) => {
        window.DormMapFeedback?.show(data.title || 'DormMap notice', data.type || 'info', data.message || '');
      });

    } catch (e) {
      console.error('DorMap Socket Init Error:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSocket);
  } else {
    initSocket();
  }
})();
