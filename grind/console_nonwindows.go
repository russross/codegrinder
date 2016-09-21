// +build !windows

package main

func getWindowsTerminalSize() (int, int, error) {
	panic("this should not be called from Linux")
}
