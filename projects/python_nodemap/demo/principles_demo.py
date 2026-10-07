class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return "..."

    def intro(self):
        return self.name + " says " + self.speak()


class Dog(Animal):
    def speak(self):
        return "Woof"


class Cat(Animal):
    def speak(self):
        return "Meow"


def describe(animal):
    return animal.intro()


rex = Dog("Rex")
tom = Cat("Tom")
pets = [rex, tom, Animal("Generic")]
for pet in pets:
    print(describe(pet))

print(type(3), type(describe), type(Dog), type(rex))
