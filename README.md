# Programmatic Directory Overlays

Useful for automatic grading when you want to ensure that students have not
modified the test files or other important components of the trusted testing
code base: `Makefiles`, other components of the build system, scoring logic,
etc. To ensure this, you _overlay_ portions from a trusted repository on top of
the student submission before beginning grading.

## Use Cases

Run from the command line:

````bash
$ overlay <configuration.yaml> <onto>
````
