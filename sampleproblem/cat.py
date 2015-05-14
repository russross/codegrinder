class Cat:

    def __init__(self, numLives):
        self.lives = numLives

    def meow(self):
        print "I have %i lives" % (self.lives)
