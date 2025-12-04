# Security Recommendations & Action Plan

## Priority 1: Critical Fixes (Implement Immediately)

### 1. Add Rate Limiting to API Endpoints

**Current State:** Only root route has rate limiting  
**Risk:** DoS attacks, database exhaustion  
**Solution:**

```javascript
// Add to server.js after existing rootLimiter
const apiLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  message: { error: 'Too many requests, please try again later' }
});

// Apply to all API routes
app.use('/api/', apiLimiter);
```

**Estimated Effort:** 15 minutes  
**Impact:** Prevents DoS attacks on all API endpoints

---

### 2. Implement Input Sanitization

**Current State:** No sanitization for usernames, room IDs  
**Risk:** XSS attacks, data corruption  
**Solution:**

Install sanitization libraries (verify package names before installation):
```bash
cd multiplayer-race
# Note: Verify these packages are maintained and compatible
npm install validator xss
```

Add validation helpers:
```javascript
const validator = require('validator');
const xss = require('xss');

function sanitizeUsername(input) {
  if (!input || typeof input !== 'string') return '';
  const cleaned = xss(input.trim());
  // Allow only alphanumeric, spaces, underscores, hyphens
  if (!/^[a-zA-Z0-9_ -]+$/.test(cleaned)) return '';
  return cleaned.substring(0, 40);
}

function sanitizeRoomId(input) {
  if (!input || typeof input !== 'string') return '';
  const cleaned = xss(input.trim());
  // Allow only alphanumeric, underscores, hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) return '';
  return cleaned.substring(0, 50);
}
```

**Estimated Effort:** 1 hour  
**Impact:** Prevents XSS and injection attacks

---

### 3. Add WebSocket Connection Limits

**Current State:** Unlimited connections per IP  
**Risk:** Resource exhaustion  
**Solution:**

```javascript
const connectionsByIP = new Map(); // Track connections per IP
const MAX_CONNECTIONS_PER_IP = 5;

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  
  // Check connection limit
  const ipConnections = connectionsByIP.get(ip) || 0;
  if (ipConnections >= MAX_CONNECTIONS_PER_IP) {
    ws.close(1013, 'Too many connections from this IP, try again later');
    return;
  }
  
  connectionsByIP.set(ip, ipConnections + 1);
  
  ws.on('close', () => {
    const count = connectionsByIP.get(ip) || 0;
    if (count <= 1) {
      connectionsByIP.delete(ip);
    } else {
      connectionsByIP.set(ip, count - 1);
    }
  });
  
  // ... rest of connection handler
});
```

**Estimated Effort:** 30 minutes  
**Impact:** Prevents connection flooding attacks

---

## Priority 2: Important Improvements (Implement Soon)

### 4. Add HTTP Security Headers

**Current State:** No security headers  
**Risk:** Clickjacking, MIME-sniffing, XSS  
**Solution:**

Install helmet:
```bash
cd multiplayer-race
npm install helmet
```

Add to server.js:
```javascript
const helmet = require('helmet');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

**Estimated Effort:** 20 minutes  
**Impact:** Protects against multiple attack vectors

---

### 5. Configure CORS Policy

**Current State:** No CORS configuration  
**Risk:** Unauthorized cross-origin requests  
**Solution:**

Install CORS:
```bash
cd multiplayer-race
npm install cors
```

Add configuration:
```javascript
const cors = require('cors');

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : '*',
  methods: ['GET', 'POST'],
  credentials: false,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
```

**Estimated Effort:** 15 minutes  
**Impact:** Controls cross-origin access

---

### 6. Add Message Size Limits for WebSocket

**Current State:** No limits on message size  
**Risk:** Memory exhaustion  
**Solution:**

```javascript
const MAX_MESSAGE_SIZE = 10240; // 10KB

ws.on('message', (buf) => {
  // Check message size
  if (buf.length > MAX_MESSAGE_SIZE) {
    ws.close(1009, 'Message too large');
    return;
  }
  
  let msg;
  try { 
    msg = JSON.parse(buf.toString()); 
  } catch { 
    return; 
  }
  // ... rest of message handler
});
```

**Estimated Effort:** 10 minutes  
**Impact:** Prevents memory exhaustion attacks

---

### 7. Sanitize Production Error Messages

**Current State:** Detailed errors exposed  
**Risk:** Information disclosure  
**Solution:**

```javascript
// Add environment detection
const isProduction = process.env.NODE_ENV === 'production';

// Update health endpoint
app.get('/api/health', async (req, res) => {
  const health = { 
    status: 'ok', 
    commit: COMMIT_SHA, 
    db: { configured: !!dbPool, ok: false } 
  };
  if (dbPool) {
    try {
      const r = await dbPool.query('SELECT 1');
      health.db.ok = !!r;
    } catch (err) {
      health.db.ok = false;
      // Don't expose error details in production
      if (!isProduction) {
        health.db.error = String(err.message || err);
      }
    }
  }
  res.json(health);
});
```

**Estimated Effort:** 20 minutes  
**Impact:** Reduces information leakage

---

## Priority 3: Long-term Enhancements

### 8. Implement Structured Logging

**Tool:** Winston or Pino  
**Benefit:** Better security monitoring  
**Effort:** 2-3 hours

### 9. Add Database Query Timeouts

**Benefit:** Prevents long-running query attacks  
**Effort:** 30 minutes

### 10. Room Cleanup & Resource Management

**Benefit:** Prevents memory leaks  
**Effort:** 1-2 hours

---

## Implementation Checklist

- [ ] Install security dependencies (helmet, cors, validator, xss)
- [ ] Add rate limiting to API endpoints
- [ ] Implement input sanitization functions
- [ ] Add WebSocket connection limits
- [ ] Configure helmet security headers
- [ ] Set up CORS policy
- [ ] Add message size limits
- [ ] Sanitize error messages
- [ ] Test all security improvements
- [ ] Update documentation
- [ ] Run CodeQL analysis
- [ ] Conduct security testing

---

## Testing Plan

### 1. Rate Limiting Tests
```bash
# Test API rate limiting
for i in {1..35}; do curl http://localhost:8080/api/health; done
# Should see rate limit error after 30 requests
```

### 2. Input Validation Tests
```bash
# Test username sanitization
curl -X POST 'http://localhost:8080' \
  -H 'Content-Type: application/json' \
  -d '{"username":"<script>alert(1)</script>"}'
# Should strip script tags
```

### 3. WebSocket Connection Tests
```bash
# Test connection limits (requires custom script)
# Connect 10 times from same IP
# Should reject after 5 connections
```

### 4. Message Size Tests
```bash
# Send large WebSocket message
# Should close connection with error
```

---

## Monitoring & Maintenance

### Ongoing Security Tasks
1. Weekly npm audit checks (automated via CI)
2. Monthly dependency updates
3. Quarterly security review
4. Monitor rate limit violations
5. Review error logs for attack patterns

### Security Metrics to Track
- Failed authentication attempts (if added)
- Rate limit hits per endpoint
- WebSocket connection rejections
- Database query timeouts
- Unusual traffic patterns

---

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Node.js Security Checklist](https://github.com/goldbergyoni/nodebestpractices#6-security-best-practices)
- [WebSocket Security](https://devcenter.heroku.com/articles/websocket-security)

---

**Last Updated:** 2025-12-04  
**Review Frequency:** Quarterly or after major changes
