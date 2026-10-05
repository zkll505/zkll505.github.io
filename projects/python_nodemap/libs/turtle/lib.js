/* turtle: lib.py draws on this editor's tkinter canvas, so there is no view here. It must be listed after tkinter in index.html. */
{
  const names = 'Turtle Screen Pen RawTurtle Vec2D forward fd back bk backward right rt left lt goto setpos setposition setx sety setheading seth home circle dot stamp '
    + 'clearstamp clearstamps speed position pos towards xcor ycor heading distance degrees radians pendown pd down penup pu up pensize width pen isdown color pencolor '
    + 'fillcolor filling begin_fill end_fill reset clear write showturtle st hideturtle ht isvisible shape shapesize turtlesize getscreen bgcolor title setup screensize '
    + 'tracer update delay onkey onkeypress onkeyrelease onscreenclick ontimer listen mainloop done exitonclick bye clearscreen resetscreen colormode textinput numinput '
    + 'window_width window_height getcanvas';
  PyLibs.add({
    name: 'turtle',
    python: 'libs/turtle/lib.py',
    members: names,
    methods: names, // after "t." where t = Turtle()
  });
}
