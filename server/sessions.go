package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/securecookie"
	. "github.com/russross/codegrinder/types"
)

type CookieSession struct {
	ExpiresAt time.Time
	UserID    int64
	path      string
}

func NewSession(id int64) *CookieSession {
	now := time.Now()
	expires := now

	// find the first expires time after now
	for i, elt := range Config.SessionsExpire {
		_, month, day := elt.Date()
		hour, minute, second := elt.Clock()
		when := time.Date(now.Year(), month, day, hour, minute, second, 0, time.Local)
		if when.Before(now) {
			when = time.Date(now.Year()+1, month, day, hour, minute, second, 0, time.Local)
		}
		if i == 0 || when.Before(expires) {
			expires = when
		}
	}

	return &CookieSession{
		ExpiresAt: expires,
		UserID:    id,
		path:      "/",
	}
}

// DecodeSession decodes a cookie value into a session
func DecodeSession(cookieValue string) (*CookieSession, error) {
	now := time.Now()

	// decode and verify signature
	session := new(CookieSession)
	secure := securecookie.New([]byte(Config.SessionSecret), nil)
	secure.MaxAge(0)
	if err := secure.Decode(CookieName, cookieValue, session); err != nil {
		return nil, fmt.Errorf("unable to decode session cookie")
	}

	// check expiration
	if session.ExpiresAt.Before(now) {
		return nil, fmt.Errorf("session is expired; must log in again to continue")
	}

	// sanity check
	if session.UserID < 1 {
		return nil, fmt.Errorf("session does not contain a legal user ID field")
	}

	return session, nil
}

func GetSession(r *http.Request) (*CookieSession, error) {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return nil, fmt.Errorf("unable to read session cookie")
	}

	return DecodeSession(cookie.Value)
}

// Encode encodes the session into a cookie value
func (session *CookieSession) Encode() (string, error) {
	// encode and sign
	secure := securecookie.New([]byte(Config.SessionSecret), nil)
	secure.MaxAge(0)
	encoded, err := secure.Encode(CookieName, session)
	if err != nil {
		return "", fmt.Errorf("creating session: %w", err)
	}
	return encoded, nil
}

func (session *CookieSession) Save(w http.ResponseWriter) string {
	encoded, err := session.Encode()
	if err != nil {
		loggedHTTPErrorf(w, http.StatusInternalServerError, "%v", err)
		return ""
	}

	cookie := &http.Cookie{
		Name:    CookieName,
		Value:   encoded,
		Path:    session.path,
		Expires: session.ExpiresAt,
		MaxAge:  int(time.Until(session.ExpiresAt).Seconds()),
		Secure:  true,
	}
	http.SetCookie(w, cookie)
	return encoded
}

func (session *CookieSession) Delete(w http.ResponseWriter) {
	epoch := time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)
	cookie := &http.Cookie{
		Name:    CookieName,
		Value:   "deleted",
		Path:    session.path,
		Expires: epoch,
		MaxAge:  -1,
		Secure:  true,
	}
	http.SetCookie(w, cookie)
}
