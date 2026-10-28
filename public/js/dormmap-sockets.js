/**
 * DorMap Real-Time WebSocket Client Controller
 * Powers live transactions, inquiries, notifications, and navigation synchronization across all pages.
 */
(function () {
  'use strict';

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
        reconnectionAttempts: 10,
        reconnectionDelay: 2000
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
        if (window.Swal) {
          window.Swal.fire({
            icon: 'success',
            title: 'Payment Successful!',
            text: `Payment of ₱${Number(data.amount || 0).toLocaleString()} for ${data.boardingHouseName || 'Rent'} has been confirmed!`,
            timer: 4000,
            timerProgressBar: true,
            toast: true,
            position: 'top-end',
            showConfirmButton: false
          });
        }
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
        } else if (window.Swal && data.senderName) {
          window.Swal.fire({
            icon: 'info',
            title: `New Message from ${data.senderName}`,
            text: data.message || 'You received a new inquiry.',
            timer: 4000,
            timerProgressBar: true,
            toast: true,
            position: 'top-end',
            showConfirmButton: false
          });
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
        if (window.Swal) {
          window.Swal.fire({
            icon: data.type || 'info',
            title: data.title || 'DorMap Notice',
            text: data.message || '',
            timer: 5000,
            timerProgressBar: true,
            toast: true,
            position: 'top-end',
            showConfirmButton: false
          });
        }
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
