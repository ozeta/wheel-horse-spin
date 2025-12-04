# REST API Security Analysis Report

## Test Date: 2025-12-04
## Scope: REST API endpoint security assessment

---

## Executive Summary

**Overall Security Rating:** ⚠️ **NEEDS IMPROVEMENT**

The REST API implements basic security measures but has several vulnerabilities that should be addressed:

**Critical Issues:** 1  
**High Priority Issues:** 2  
**Medium Priority Issues:** 3  
**Low Priority Issues:** 2  

**Primary Concerns:**
1. Missing rate limiting on most endpoints (DoS vulnerability)
2. No input validation on path parameters
3. Missing HTTP security headers
4. No authentication/authorization mechanism

---

## 1. API Endpoint Inventory

| Endpoint | Method | Auth | Rate Limit | Input Validation | Status |
|----------|--------|------|------------|------------------|--------|
| `/` | GET | None | ✅ Yes | N/A | ⚠️ |
| `/api/commit` | GET | None | ❌ No | N/A | ⚠️ |
| `/api/health` | GET | None | ❌ No | N/A | ⚠️ |
| `/api/leaderboard/fastest` | GET | None | ❌ No | N/A | ❌ |
| `/api/leaderboard/top` | GET | None | ❌ No | N/A | ❌ |
| `/api/leaderboard/player/:username` | GET | None | ❌ No | ⚠️ Minimal | ❌ |
| `/api/leaderboard/last-humans` | GET | None | ❌ No | ⚠️ Minimal | ❌ |
| `/api/leaderboard/room-summary` | GET | None | ❌ No | ⚠️ Minimal | ❌ |
| `/api/leaderboard/room-loses` | GET | None | ❌ No | ⚠️ Minimal | ❌ |
| `/api/leaderboard/room-stats` | GET | None | ❌ No | ⚠️ Minimal | ❌ |
| Static files | GET | None | ❌ No | N/A | ⚠️ |

---

## 2. Detailed Endpoint Analysis

### 2.1 GET `/api/commit`

**Purpose:** Return current git commit SHA  
**Location:** server.js, lines 275-277

```javascript
app.get('/api/commit', (req, res) => {
  res.json({ sha: COMMIT_SHA });
});
```

**Security Analysis:**

| Aspect | Status | Notes |
|--------|--------|-------|
| Authentication | ❌ None | Public endpoint (acceptable) |
| Rate Limiting | ❌ Missing | Vulnerable to DoS |
| Input Validation | ✅ N/A | No user input |
| Output Sanitization | ✅ Safe | Static value |
| Error Handling | ✅ None needed | Simple response |
| Information Disclosure | ⚠️ Low risk | Commit SHA not sensitive |

**Vulnerabilities:**
- **DoS Risk (Medium):** Can be flooded without rate limiting

**Recommendations:**
1. Add rate limiting (30 req/min)
2. Consider caching response

**Risk Level:** MEDIUM

---

### 2.2 GET `/api/health`

**Purpose:** Health check with database status  
**Location:** server.js, lines 280-292

```javascript
app.get('/api/health', async (req, res) => {
  const health = { status: 'ok', commit: COMMIT_SHA, db: { configured: !!dbPool, ok: false } };
  if (dbPool) {
    try {
      const r = await dbPool.query('SELECT 1');
      health.db.ok = !!r;
    } catch (err) {
      health.db.ok = false;
      health.db.error = String(err.message || err);
    }
  }
  res.json(health);
});
```

**Security Analysis:**

| Aspect | Status | Notes |
|--------|--------|-------|
| Authentication | ❌ None | Public health check (common) |
| Rate Limiting | ❌ Missing | Can overwhelm DB |
| Input Validation | ✅ N/A | No user input |
| Output Sanitization | ⚠️ Partial | Exposes error messages |
| Error Handling | ✅ Good | Try-catch present |
| Information Disclosure | ⚠️ Medium | DB errors exposed |

**Vulnerabilities:**
1. **Information Disclosure (Medium):** Database error messages exposed
   - Could reveal DB version, connection details
   - Should sanitize in production

2. **DoS Risk (High):** Database query on every request
   - No rate limiting
   - Could exhaust DB connections
   - Could be used to probe DB availability

**Recommendations:**
1. Add aggressive rate limiting (10 req/min)
2. Sanitize error messages in production
3. Add caching for health status
4. Consider basic auth for detailed health info

**Risk Level:** HIGH

---

### 2.3 GET `/api/leaderboard/fastest`

**Purpose:** Top 10 fastest race times  
**Location:** server.js, lines 295-309

```javascript
app.get('/api/leaderboard/fastest', async (req, res) => {
  if (!dbPool) return res.json({ items: [] });
  try {
    const { rows } = await dbPool.query(`
      SELECT r.winner_username AS username, r.winner_time_seconds AS time, 
             r.race_timestamp AS ts, r.room_id
      FROM races r
      ORDER BY r.winner_time_seconds ASC
      LIMIT 10
    `);
    res.json({ items: rows });
  } catch (err) {
    console.error('[api] fastest error', err);
    res.json({ items: [] });
  }
});
```

**Security Analysis:**

| Aspect | Status | Notes |
|--------|--------|-------|
| Authentication | ❌ None | Public leaderboard (acceptable) |
| Rate Limiting | ❌ Missing | Database query on each request |
| Input Validation | ✅ N/A | No parameters |
| SQL Injection | ✅ Secure | Static query |
| Error Handling | ✅ Good | Try-catch, silent failure |
| Caching | ❌ None | Same data returned frequently |

**Vulnerabilities:**
1. **DoS Risk (High):** Unlimited DB queries
2. **Resource Waste (Low):** No caching of static data

**Recommendations:**
1. Add rate limiting (20 req/min)
2. Implement caching (5-minute TTL)
3. Add ETag support for efficient updates

**Risk Level:** HIGH

---

### 2.4 GET `/api/leaderboard/player/:username`

**Purpose:** Get race history for a specific player  
**Location:** server.js, lines 328-346

```javascript
app.get('/api/leaderboard/player/:username', async (req, res) => {
  const username = String(req.params.username || '').trim();
  if (!dbPool || !username) return res.json({ items: [] });
  try {
    const { rows } = await dbPool.query(`
      SELECT r.race_timestamp AS ts, rp.final_position AS position, 
             rp.finish_time_seconds AS time,
             rp.delta_from_winner_seconds AS delta, r.total_participants AS total
      FROM race_participants rp
      JOIN races r ON rp.race_id = r.id
      WHERE rp.username = $1 AND rp.is_bot = false
      ORDER BY r.race_timestamp DESC
      LIMIT 20
    `, [username]);
    res.json({ items: rows });
  } catch (err) {
    console.error('[api] player error', err);
    res.json({ items: [] });
  }
});
```

**Security Analysis:**

| Aspect | Status | Notes |
|--------|--------|-------|
| Authentication | ❌ None | Public data (acceptable) |
| Rate Limiting | ❌ Missing | Can enumerate all users |
| Input Validation | ⚠️ Minimal | String() + trim() + max 40 chars (line 669) |
| SQL Injection | ✅ Secure | Parameterized query |
| Error Handling | ✅ Good | Try-catch present |
| User Enumeration | ⚠️ Possible | Can probe for usernames |

**Vulnerabilities:**

1. **Input Validation (Medium):**
   ```javascript
   // Current: Only basic validation
   const username = String(req.params.username || '').trim();
   
   // Issues:
   // - No length limit enforcement
   // - No character validation
   // - No sanitization
   // - Accepts special characters
   ```

   **Note:** Length is enforced (40 chars max in WebSocket handler), but no format or character validation.
   
   **Test Cases:**
   - `../../../etc/passwd` - Path traversal (shows lack of format validation)
   - `<script>alert(1)</script>` - XSS (not directly exploitable in JSON but poor practice)
   - `' OR '1'='1` - SQL injection attempt (blocked by parameterization, but indicates need for format validation)

2. **User Enumeration (Medium):**
   - Attacker can probe for valid usernames
   - Different response for existing vs. non-existing users
   - No rate limiting allows automated enumeration

3. **DoS Risk (High):**
   - No rate limiting on database queries
   - Can request data for unlimited users

**Recommendations:**

1. **Add Input Validation:**
   ```javascript
   function validateUsername(username) {
     if (!username || typeof username !== 'string') return null;
     const cleaned = username.trim();
     if (cleaned.length < 1 || cleaned.length > 40) return null;
     if (!/^[a-zA-Z0-9_ -]+$/.test(cleaned)) return null;
     return cleaned;
   }
   
   app.get('/api/leaderboard/player/:username', async (req, res) => {
     const username = validateUsername(req.params.username);
     if (!username) {
       return res.status(400).json({ error: 'Invalid username format' });
     }
     if (!dbPool) {
       return res.status(503).json({ error: 'Database unavailable' });
     }
     // ... query logic
   });
   ```

2. **Add Rate Limiting:**
   - 30 requests per minute per IP
   - Stricter for path parameters (prevent enumeration)

3. **Add Caching:**
   - Cache player data for 2-5 minutes
   - Reduce database load

**Risk Level:** HIGH

---

### 2.5 GET `/api/leaderboard/last-humans`

**Purpose:** Players who finished last among humans  
**Location:** server.js, lines 349-372

```javascript
app.get('/api/leaderboard/last-humans', async (req, res) => {
  if (!dbPool) return res.json({ items: [] });
  try {
    const room = (req.query.room && String(req.query.room).trim()) || null;
    const sql = `
      SELECT DISTINCT ON (rp.username)
        rp.username,
        rp.human_finish_time_seconds AS time,
        r.race_timestamp AS ts,
        r.room_id
      FROM race_participants rp
      JOIN races r ON r.id = rp.race_id
      WHERE rp.is_last_human = TRUE AND rp.is_bot = FALSE
      ${room ? 'AND r.room_id = $1' : ''}
      ORDER BY rp.username, r.race_timestamp DESC
    `;
    const params = room ? [room] : [];
    const { rows } = await dbPool.query(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error('[api] last-humans error', err);
    res.json({ items: [] });
  }
});
```

**Security Analysis:**

| Aspect | Status | Notes |
|--------|--------|-------|
| Authentication | ❌ None | Public data |
| Rate Limiting | ❌ Missing | Database query each request |
| Input Validation | ⚠️ Minimal | Only String() + trim() |
| SQL Injection | ✅ Secure | Parameterized query |
| Dynamic SQL | ⚠️ Acceptable | Template literal safe here |

**Vulnerabilities:**

1. **Input Validation (Medium):** Room query parameter not validated
   ```javascript
   const room = (req.query.room && String(req.query.room).trim()) || null;
   // No validation of room format
   ```

2. **DoS Risk (High):** Unlimited queries without rate limiting

**Recommendations:**
1. Validate room parameter format
2. Add rate limiting
3. Add caching

**Risk Level:** HIGH

---

### 2.6 GET `/api/leaderboard/room-summary` & `/room-loses` & `/room-stats`

**Purpose:** Room-specific aggregated statistics  
**Location:** server.js, lines 375-548

**Security Analysis:** Similar issues across all three endpoints

| Aspect | Status | Notes |
|--------|--------|-------|
| Authentication | ❌ None | Public data |
| Rate Limiting | ❌ Missing | Complex queries, high cost |
| Input Validation | ⚠️ Minimal | Room parameter not validated |
| SQL Injection | ✅ Secure | Parameterized queries |
| Performance | ⚠️ Concerning | Expensive aggregations |

**Vulnerabilities:**

1. **DoS Risk (CRITICAL):**
   - Complex aggregation queries (GROUP BY, COUNT, etc.)
   - No rate limiting
   - Expensive operations on every request
   - Could exhaust database resources

2. **Input Validation (Medium):**
   ```javascript
   const room = (req.query.room && String(req.query.room).trim()) || null;
   if (!room) return res.json({ items: [] });
   // Room format not validated
   ```

3. **Missing Required Parameter Handling:**
   - Returns empty result instead of 400 Bad Request
   - Poor API design

**Recommendations:**

1. **Critical: Add Rate Limiting**
   ```javascript
   const statsLimiter = RateLimit({
     windowMs: 1 * 60 * 1000,
     max: 10, // Very restrictive for expensive queries
     message: { error: 'Too many requests for stats endpoints' }
   });
   
   app.get('/api/leaderboard/room-stats', statsLimiter, async (req, res) => {
     // ...
   });
   ```

2. **Add Input Validation:**
   ```javascript
   function validateRoomId(room) {
     if (!room || typeof room !== 'string') return null;
     const cleaned = room.trim();
     if (cleaned.length < 1 || cleaned.length > 50) return null;
     if (!/^[a-zA-Z0-9_-]+$/.test(cleaned)) return null;
     return cleaned;
   }
   ```

3. **Add Response Caching:**
   - Cache aggregated stats for 5-10 minutes
   - Significantly reduce DB load

4. **Return Proper Error Codes:**
   ```javascript
   if (!room) {
     return res.status(400).json({ error: 'Room parameter required' });
   }
   ```

**Risk Level:** CRITICAL

---

## 3. HTTP Security Headers Analysis

**Current State:** ❌ **NOT IMPLEMENTED**

No security headers are configured. The application is vulnerable to:

### 3.1 Missing Headers

| Header | Purpose | Risk if Missing | Priority |
|--------|---------|-----------------|----------|
| Strict-Transport-Security | Enforce HTTPS | MitM attacks | High |
| X-Frame-Options | Prevent clickjacking | Clickjacking | High |
| X-Content-Type-Options | Prevent MIME sniffing | Content sniffing | Medium |
| Content-Security-Policy | XSS protection | XSS attacks | High |
| X-XSS-Protection | Legacy XSS protection | XSS (old browsers) | Low |
| Referrer-Policy | Control referrer info | Info leakage | Low |
| Permissions-Policy | Control browser features | Privacy/security | Medium |

### 3.2 Recommendations

Install and configure helmet:

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
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  }
}));
```

**Impact:** Protects against multiple attack vectors

---

## 4. CORS Analysis

**Current State:** ❌ **NOT CONFIGURED**

### 4.1 Issues

- No CORS headers sent
- Any origin can make requests (browser default)
- No control over allowed methods
- No preflight handling

### 4.2 Recommendations

```javascript
const cors = require('cors');

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*', // Restrict in production
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
  credentials: false,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
```

---

## 5. Rate Limiting Deep Dive

### 5.1 Current Implementation

**Location:** server.js, lines 552-558

```javascript
const rootLimiter = RateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 min
});
app.get('/', rootLimiter, (req, res) => {
  res.sendFile(path.join(staticPath, 'game.html'));
});
```

**Coverage:** Only root route (`/`)  
**Gap:** 10 API endpoints unprotected

### 5.2 Recommended Rate Limits

| Endpoint Category | Requests/Min | Reasoning |
|-------------------|--------------|-----------|
| `/api/commit` | 30 | Static data, can be cached |
| `/api/health` | 10 | DB query, monitoring only |
| `/api/leaderboard/fastest` | 20 | Cacheable, moderate cost |
| `/api/leaderboard/top` | 20 | Cacheable, moderate cost |
| `/api/leaderboard/player/:username` | 15 | Enumerate protection |
| `/api/leaderboard/last-humans` | 15 | Moderate cost |
| `/api/leaderboard/room-*` | 10 | Expensive aggregations |

### 5.3 Implementation

```javascript
// Different limiters for different endpoint types
const apiLimiter = RateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Too many API requests' }
});

const statsLimiter = RateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { error: 'Too many stats requests' }
});

const healthLimiter = RateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { error: 'Too many health checks' }
});

// Apply to endpoints
app.get('/api/health', healthLimiter, ...);
app.get('/api/commit', apiLimiter, ...);
app.get('/api/leaderboard/room-*', statsLimiter, ...);
app.use('/api/', apiLimiter); // Default for others
```

---

## 6. Error Handling Security

### 6.1 Current Approach

```javascript
try {
  // Database query
} catch (err) {
  console.error('[api] error', err);
  res.json({ items: [] });
}
```

**Issues:**
1. ✅ Doesn't expose errors to client (good)
2. ❌ Silent failures (poor UX)
3. ❌ Logs full errors to console (could leak info in production)
4. ❌ Returns 200 OK with empty data (should be 500)

### 6.2 Recommendations

```javascript
const isProduction = process.env.NODE_ENV === 'production';

try {
  const { rows } = await dbPool.query(...);
  res.json({ items: rows });
} catch (err) {
  if (!isProduction) {
    console.error('[api] error', err);
  } else {
    console.error('[api] error', err.message); // Message only
  }
  res.status(500).json({ 
    error: 'Internal server error',
    items: [] 
  });
}
```

---

## 7. Performance & Caching

### 7.1 Current State
- ❌ No caching implemented
- ❌ Database queries on every request
- ❌ No ETag support
- ❌ No conditional requests

### 7.2 Impact
- Unnecessary database load
- Slower response times
- Higher costs
- Poor scalability

### 7.3 Recommendations

```javascript
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes

app.get('/api/leaderboard/fastest', async (req, res) => {
  const cacheKey = 'leaderboard:fastest';
  const cached = cache.get(cacheKey);
  
  if (cached) {
    return res.json(cached);
  }
  
  if (!dbPool) return res.json({ items: [] });
  
  try {
    const { rows } = await dbPool.query(...);
    const response = { items: rows };
    cache.set(cacheKey, response);
    res.json(response);
  } catch (err) {
    // ...
  }
});
```

---

## 8. Summary of Vulnerabilities

### Critical (Fix Immediately)
1. **Missing Rate Limiting on Stats Endpoints**
   - Impact: Database exhaustion, DoS
   - Affected: `/api/leaderboard/room-*`
   - Fix: Add strict rate limiting (10 req/min)

### High Priority (Fix Soon)
1. **Missing Rate Limiting on API Endpoints**
   - Impact: DoS, resource exhaustion
   - Affected: All `/api/*` endpoints
   - Fix: Implement per-endpoint rate limiting

2. **Insufficient Input Validation**
   - Impact: Data integrity, user enumeration
   - Affected: All endpoints with parameters
   - Fix: Add validation functions

3. **Missing HTTP Security Headers**
   - Impact: XSS, clickjacking, various attacks
   - Affected: All endpoints
   - Fix: Install helmet middleware

### Medium Priority
1. **No Caching**
   - Impact: Poor performance, high DB load
   - Fix: Implement response caching

2. **Information Disclosure**
   - Impact: Error details leaked
   - Fix: Sanitize error messages

3. **Poor Error Responses**
   - Impact: Poor UX, incorrect status codes
   - Fix: Return proper HTTP status codes

### Low Priority
1. **No CORS Configuration**
   - Impact: Uncontrolled cross-origin access
   - Fix: Configure CORS policy

2. **No Authentication**
   - Impact: None (public API by design)
   - Fix: Not needed for current scope

---

## 9. Testing Recommendations

### 9.1 Rate Limit Testing
```bash
# Test API rate limiting
for i in {1..35}; do 
  curl -s http://localhost:8080/api/health | jq .
  sleep 0.1
done
# Should see rate limit error after limit reached
```

### 9.2 Input Validation Testing
```bash
# Test invalid usernames
curl "http://localhost:8080/api/leaderboard/player/%3Cscript%3Ealert(1)%3C%2Fscript%3E"
curl "http://localhost:8080/api/leaderboard/player/'%20OR%20'1'='1"
curl "http://localhost:8080/api/leaderboard/player/$(python -c 'print("A"*1000)')"
```

### 9.3 DoS Testing
```bash
# Stress test stats endpoints
ab -n 100 -c 10 http://localhost:8080/api/leaderboard/room-stats?room=test
```

---

## 10. Compliance Checklist

### OWASP API Security Top 10 Compliance

| Item | Status | Notes |
|------|--------|-------|
| API1: Broken Object Level Authorization | N/A | No user objects/ownership |
| API2: Broken Authentication | ⚠️ By Design | No auth required (public game) |
| API3: Broken Object Property Level Authorization | ⚠️ | Public data exposure acceptable |
| API4: Unrestricted Resource Consumption | ❌ | Missing rate limiting |
| API5: Broken Function Level Authorization | N/A | No privileged functions |
| API6: Unrestricted Access to Sensitive Business Flows | ⚠️ | User enumeration possible |
| API7: Server Side Request Forgery | N/A | No external requests |
| API8: Security Misconfiguration | ❌ | Missing headers, rate limits |
| API9: Improper Inventory Management | ✅ | Well documented |
| API10: Unsafe Consumption of APIs | N/A | No external API consumption |

---

## 11. Action Plan

### Week 1: Critical Fixes
- [ ] Implement rate limiting on all API endpoints
- [ ] Add helmet middleware for security headers
- [ ] Add input validation for all parameters

### Week 2: High Priority
- [ ] Implement response caching
- [ ] Configure CORS policy
- [ ] Sanitize error messages

### Week 3: Testing & Documentation
- [ ] Security testing
- [ ] Update API documentation
- [ ] Monitor rate limit violations

---

**Report Generated:** 2025-12-04  
**Analyst:** GitHub Copilot Security Analysis  
**Next Review:** After implementing critical fixes  
**Confidence Level:** HIGH
