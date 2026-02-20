// Shared auth utilities for all frontend pages
const AUTH = {
    getToken() { return localStorage.getItem('playmate_token'); },
    getPlayer() {
        const data = localStorage.getItem('playmate_player');
        return data ? JSON.parse(data) : null;
    },
    isLoggedIn() { return !!this.getToken(); },
    isAdmin() { return this.getPlayer()?.is_admin === 1; },

    save(token, player) {
        localStorage.setItem('playmate_token', token);
        localStorage.setItem('playmate_player', JSON.stringify(player));
    },

    logout() {
        const token = this.getToken();
        if (token) {
            fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => { });
        }
        localStorage.removeItem('playmate_token');
        localStorage.removeItem('playmate_player');
        localStorage.removeItem('playmate_player_id');
        localStorage.removeItem('playmate_player_name');
        window.location.href = 'login.html';
    },

    headers() {
        const h = { 'Content-Type': 'application/json' };
        const token = this.getToken();
        if (token) h['Authorization'] = `Bearer ${token}`;
        return h;
    },

    // Update navbar with login state
    updateNavbar() {
        const navRight = document.getElementById('navAuthArea');
        if (!navRight) return;

        if (this.isLoggedIn()) {
            const player = this.getPlayer();
            navRight.innerHTML = `
                <li class="nav-item position-relative me-2">
                    <a class="nav-link" href="dashboard.html">
                        🔔
                        <span id="notifBadge" class="position-absolute top-10 start-100 translate-middle badge rounded-pill bg-danger" style="display:none; font-size: 0.6rem;">
                            0
                        </span>
                    </a>
                </li>
                <li class="nav-item"><a class="nav-link" href="dashboard.html">⚡ ${player?.name || 'Dashboard'}</a></li>
                ${this.isAdmin() ? '<li class="nav-item"><a class="nav-link text-warning" href="admin.html">👑 Admin</a></li>' : ''}
                <li class="nav-item"><a class="nav-link text-danger" href="#" onclick="AUTH.logout(); return false;">Logout</a></li>
            `;
            this.checkNotifications();
        } else {
            navRight.innerHTML = `
                <li class="nav-item"><a class="nav-link btn btn-success text-dark px-3 ms-2" href="login.html">Login</a></li>
            `;
        }
    },

    // Require login — redirects if not logged in
    requireLogin() {
        if (!this.isLoggedIn()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    },

    // Check for pending notifications (connections)
    async checkNotifications() {
        if (!this.isLoggedIn()) return;
        try {
            const res = await fetch('/api/connections/my', { headers: this.headers() });
            if (!res.ok) return;
            const data = await res.json();
            const pendingCount = (data.incoming || []).filter(c => c.status === 'pending').length;

            const badge = document.getElementById('notifBadge');
            if (badge) {
                if (pendingCount > 0) {
                    badge.textContent = pendingCount;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            }
        } catch (e) {
            console.error('Notif error:', e);
        }
    }
};
