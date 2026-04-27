/**
 * app.js — NexChat Entry Point
 *
 * Creates all MVC layers and wires dependencies together.
 * This file should contain ZERO business logic — only instantiation and wiring.
 *
 * Load order (enforced by index.html):
 *   crypto.js → models/* → views/* → controllers/* → app.js
 *
 * Dependency graph (post-wiring):
 *
 *   AuthController ──► SocketController ──► ChatController
 *         │                   │                   │
 *         │             FriendController ◄────────┘
 *         │                   │
 *         └────── AuthModel, UserModel, ChatModel (shared state)
 *                AuthView, SidebarView, ChatView, ToastView (shared DOM)
 */
'use strict';

const REST_URL = 'http://localhost:5000';
const WS_URL   = 'ws://localhost:5001';

// =============================================================================
// MODELS — pure state, no side effects
// =============================================================================
const authModel = new AuthModel();
const userModel = new UserModel();
const chatModel = new ChatModel();

// =============================================================================
// VIEWS — DOM wrappers, no business logic
// =============================================================================
const authView    = new AuthView();
const sidebarView = new SidebarView();
const chatView    = new ChatView();
const toastView   = new ToastView();
const callView    = new CallView();

// =============================================================================
// CONTROLLERS — orchestration; wired after construction to break circular deps
// =============================================================================

const socketCtrl = new SocketController(chatModel, { WS_URL });

const callCtrl = new CallController(authModel, callView, toastView);

const chatCtrl = new ChatController(
  authModel, chatModel, userModel,
  chatView, sidebarView, toastView,
  REST_URL
);

const friendCtrl = new FriendController(
  authModel, userModel, chatModel,
  sidebarView, chatView, toastView,
  REST_URL
);

const authCtrl = new AuthController(
  authModel, userModel, chatModel,
  authView, sidebarView, chatView, toastView,
  REST_URL
);

// =============================================================================
// POST-CONSTRUCTION WIRING — resolves circular dependencies
// =============================================================================
socketCtrl.wire({ chatCtrl, friendCtrl, authCtrl, callCtrl, userModel, authModel, sidebarView, chatView, toastView });
chatCtrl.wire(socketCtrl, friendCtrl);
friendCtrl.wire(socketCtrl, chatCtrl);
authCtrl.wire(socketCtrl, chatCtrl, friendCtrl);
callCtrl.wire(socketCtrl);
