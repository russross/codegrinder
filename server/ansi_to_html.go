package main

import (
	"fmt"
	"html"
	"strconv"
	"strings"
	"unicode/utf8"
)

// ANSIToHTMLPre wraps the converted HTML in a <pre> with inline styles.
func ANSIToHTMLPre(s string) string {
	var b strings.Builder
	b.WriteString(`<pre style="color:white;background-color:black;">`)
	b.WriteString(ansiToInlineHTML(s))
	b.WriteString(`</pre>`)
	return b.String()
}

type rgb struct{ r, g, b int }

type style struct {
	fg, bg    *rgb
	bold      bool
	dim       bool
	italic    bool
	underline bool
	strike    bool
	inverse   bool
}

// css returns inline CSS for the style.
func (s style) css() string {
	var parts []string
	fg, bg := s.fg, s.bg
	if s.inverse {
		fg, bg = bg, fg
	}
	if fg != nil {
		parts = append(parts, fmt.Sprintf("color:rgb(%d,%d,%d)", fg.r, fg.g, fg.b))
	}
	if bg != nil {
		parts = append(parts, fmt.Sprintf("background-color:rgb(%d,%d,%d)", bg.r, bg.g, bg.b))
	}
	if s.bold {
		parts = append(parts, "font-weight:bold")
	}
	if s.dim {
		parts = append(parts, "opacity:0.75")
	}
	if s.italic {
		parts = append(parts, "font-style:italic")
	}
	if s.underline {
		parts = append(parts, "text-decoration:underline")
	}
	if s.strike {
		parts = append(parts, "text-decoration:line-through")
	}
	// If both underline+strike were set, combine:
	if s.underline && s.strike {
		parts = append(parts[:len(parts)-2], "text-decoration:underline line-through")
	}
	return strings.Join(parts, ";")
}

func (s *style) reset()   { *s = style{} }
func (s *style) resetFG() { s.fg = nil }
func (s *style) resetBG() { s.bg = nil }
func (s *style) applySGR(params []int) {
	if len(params) == 0 {
		s.reset()
		return
	}
	for i := 0; i < len(params); i++ {
		p := params[i]
		switch p {
		case 0:
			s.reset()
		case 1:
			s.bold = true
		case 2:
			s.dim = true
		case 3:
			s.italic = true
		case 4:
			s.underline = true
		case 9:
			s.strike = true
		case 22:
			s.bold = false
			s.dim = false
		case 23:
			s.italic = false
		case 24:
			s.underline = false
		case 29:
			s.strike = false
		case 7:
			s.inverse = true
		case 27:
			s.inverse = false

		// 30–37 / 90–97: set 16-color FG
		case 30, 31, 32, 33, 34, 35, 36, 37:
			c := ansiBasicColor(p - 30)
			s.fg = &c
		case 90, 91, 92, 93, 94, 95, 96, 97:
			c := ansiBasicBrightColor(p - 90)
			s.fg = &c

		// 40–47 / 100–107: set 16-color BG
		case 40, 41, 42, 43, 44, 45, 46, 47:
			c := ansiBasicColor(p - 40)
			s.bg = &c
		case 100, 101, 102, 103, 104, 105, 106, 107:
			c := ansiBasicBrightColor(p - 100)
			s.bg = &c

		case 39:
			s.resetFG()
		case 49:
			s.resetBG()

		// 38 / 48 extended color (256 or truecolor)
		case 38, 48:
			isFG := (p == 38)
			// need at least next param
			if i+1 < len(params) {
				mode := params[i+1]
				if mode == 5 && i+2 < len(params) { // 256-color: 38;5;n / 48;5;n
					n := params[i+2]
					col := xterm256(n)
					if isFG {
						s.fg = &col
					} else {
						s.bg = &col
					}
					i += 2
				} else if mode == 2 && i+4 < len(params) { // truecolor: 38;2;r;g;b
					col := rgb{params[i+2], params[i+3], params[i+4]}
					if isFG {
						s.fg = &col
					} else {
						s.bg = &col
					}
					i += 4
				} else {
					// unknown form, skip the mode only
					i++
				}
			}
		}
	}
}

func ansiToInlineHTML(s string) string {
	var b strings.Builder
	cur := style{}
	spanOpen := false
	flushOpen := func() {
		if spanOpen {
			b.WriteString("</span>")
			spanOpen = false
		}
	}
	openFor := func(st style) {
		css := st.css()
		if css != "" {
			b.WriteString(`<span style="` + css + `">`)
			spanOpen = true
		}
	}

	for i := 0; i < len(s); {
		// Look for ESC [
		if s[i] == 0x1b && i+1 < len(s) && s[i+1] == '[' {
			// write any preceding text
			// (nothing to do; we only write when we pass text)
			// parse CSI ... m
			j := i + 2
			for j < len(s) {
				c := s[j]
				if (c >= '0' && c <= '9') || c == ';' {
					j++
					continue
				}
				break
			}
			if j < len(s) && s[j] == 'm' {
				seq := s[i+2 : j]
				params := parseInts(seq)
				flushOpen()
				cur.applySGR(params)
				openFor(cur)
				i = j + 1
				continue
			}
			// Not an SGR; emit ESC as text
		}

		// emit this rune as escaped HTML
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			// fall back to raw byte
			b.WriteString(html.EscapeString(s[i : i+1]))
			i++
			continue
		}
		b.WriteString(html.EscapeString(string(r)))
		i += size
	}
	if spanOpen {
		b.WriteString("</span>")
	}
	return b.String()
}

func parseInts(s string) []int {
	if strings.TrimSpace(s) == "" {
		return []int{0}
	}
	parts := strings.Split(s, ";")
	out := make([]int, 0, len(parts))
	for _, p := range parts {
		if p == "" {
			// Empty parameters are treated as 0 in many emitters; keep behavior friendly:
			out = append(out, 0)
			continue
		}
		if n, err := strconv.Atoi(p); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// ---- Color helpers ----

func ansiBasicColor(n int) rgb { // 0..7
	switch n {
	case 0:
		return rgb{0, 0, 0} // black
	case 1:
		return rgb{205, 49, 49} // red
	case 2:
		return rgb{13, 188, 121} // green
	case 3:
		return rgb{229, 229, 16} // yellow
	case 4:
		return rgb{36, 114, 200} // blue
	case 5:
		return rgb{188, 63, 188} // magenta
	case 6:
		return rgb{17, 168, 205} // cyan
	default:
		return rgb{229, 229, 229} // white (7)
	}
}

func ansiBasicBrightColor(n int) rgb { // 0..7
	switch n {
	case 0:
		return rgb{102, 102, 102} // bright black (gray)
	case 1:
		return rgb{241, 76, 76}
	case 2:
		return rgb{35, 209, 139}
	case 3:
		return rgb{245, 245, 67}
	case 4:
		return rgb{59, 142, 234}
	case 5:
		return rgb{214, 112, 214}
	case 6:
		return rgb{41, 184, 219}
	default:
		return rgb{255, 255, 255} // bright white
	}
}

// xterm256 converts 0..255 to RGB per xterm palette spec.
func xterm256(n int) rgb {
	if n < 0 {
		n = 0
	}
	if n > 255 {
		n = 255
	}
	switch {
	case n < 16:
		if n < 8 {
			return ansiBasicColor(n)
		}
		return ansiBasicBrightColor(n - 8)
	case n >= 16 && n <= 231: // 6x6x6 cube
		n -= 16
		r := n / 36
		g := (n % 36) / 6
		b := n % 6
		return rgb{cube(r), cube(g), cube(b)}
	default: // 232..255 grayscale
		gray := 8 + (n-232)*10
		return rgb{gray, gray, gray}
	}
}

func cube(v int) int {
	// 0->0, 1->95, 2->135, 3->175, 4->215, 5->255
	steps := []int{0, 95, 135, 175, 215, 255}
	if v < 0 {
		v = 0
	}
	if v > 5 {
		v = 5
	}
	return steps[v]
}
