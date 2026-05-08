
i read thru @docs/hello.json looks like the tool calls are ass, and looks like the its looking at basic cryptos, and it doesnt even call get search or use the search functionality, it needs to use the SEARCH tool FIRST to FIND interesting stocks to pick, and out of the interesting stocks, it needs to actually pick a stock, right now it doesnt actually does its purpose - searching for SOMETHING to invest in, I think it might be the model im using ~ but even with this model, we dont even have the search tool attached to the selector, it needs to have the tools in here: 


| Agent                 | Tools                                                                   | Safety cap | Budget limit | Execution model                                           |
| --------------------- | ----------------------------------------------------------------------- | ---------- | ------------ | --------------------------------------------------------- |
| `instrument_selector` | `search_web`, `get_quote`, `get_ohlcv`, `get_news`, `submit_candidates` | 25 steps   | $0.15/burst  | Discovery loop; terminates by calling `submit_candidates` |
| `analyst_technical`   | `search_web`, `get_news`                                                | 12 steps   | $0.08/run    | Depth loop on injected structured data                    |
| `analyst_fundamental` | `search_web`, `get_news`                                                | 12 steps   | $0.08/run    | Depth loop on injected structured data                    |
| `reviewer`            | `search_web`                                                            | 8 steps    | $0.05/run    | Spot-check verification + synthesis                       |
| `decision_maker`      | none                                                                    | 1 step     | $0.04/run    | Single-shot structured output (no tool loop)             |

Do a full autopsy on what the fuck is going on, the instrument selector should actually be selecting instruments, not looking through them. It will THEN check the system to see if we have access to the quotes. The AI needs to use get news and search web FIRST. 

What I want you to do: use ur skill to write a good plan to fix these issues. I think the main issue is the system prompt. 