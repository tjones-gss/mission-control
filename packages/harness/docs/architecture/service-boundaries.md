# Service Boundaries

| Boundary | Owns | Must Not Do | Notes |
|---|---|---|---|
| UI | rendering, basic validation | enforce security alone | |
| API | request/response, auth boundary | contain deep business logic | |
| Service | business logic | render UI | |
| Data Access | persistence | business decisions | |
